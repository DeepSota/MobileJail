"""State-only parallel runner for CodeAgent."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import time
from pathlib import Path
from typing import Any, Callable

from bench_env.env import EnvPool
from bench_env.env.base import ActionType, Observation
from bench_env.llm import LLMClient
from bench_env.runner.base import EpisodeResult, Evaluator, ExecutionResult

from .mock_codeagent import (
    CodeAgent,
    CodeAgentExecutionError,
    CodeAgentPlanningError,
)
from .mock_tasks import TaskDescriptor, instantiate_task


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if dataclasses.is_dataclass(value):
        return _json_safe(dataclasses.asdict(value))
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return repr(value)


async def _run_episode(
    env: Any,
    agent: CodeAgent,
    task: Any,
    *,
    episode_timeout_s: float,
) -> dict[str, Any]:
    started = time.monotonic()
    initial_obs = None
    final_obs = None
    outcome = None
    planning_attempts: list[dict[str, str]] = []
    execution_error = None
    execution_failure: CodeAgentExecutionError | None = None
    try:
        # Reuse the complete BaseTask.setup lifecycle while replacing only its
        # final observation capture. MobileGymEnv.get_observation() normally
        # takes a screenshot; CodeAgent is state-only, so no screenshot should
        # be captured, stored, or sent to the model.
        original_get_observation = env.get_observation

        async def state_only_observation() -> Observation:
            state, route = await asyncio.gather(
                env.get_state(
                    required_apps=list(task.apps) if task.apps else None
                ),
                env.get_route(),
            )
            return Observation(
                state=state,
                route=route,
                step_idx=0,
                screenshot_base64="",
                screenshot_bytes=b"",
                screenshot=None,
            )

        env.get_observation = state_only_observation
        try:
            initial_obs = await task.setup(env)
        finally:
            env.get_observation = original_get_observation
        outcome = await asyncio.wait_for(
            agent.run(
                env,
                task.description,
                app_ids=list(task.apps),
                repair_feedback=getattr(task, "_codeagent_repair_feedback", ""),
            ),
            timeout=max(1.0, episode_timeout_s),
        )
        final_state = await env.get_state(
            required_apps=list(task.apps) if task.apps else None
        )
        final_route = await env.get_route()
        final_obs = dataclasses.replace(
            initial_obs,
            state=final_state,
            route=final_route,
            screenshot_base64="",
            screenshot_bytes=b"",
            screenshot=None,
        )
    except CodeAgentExecutionError as exc:
        execution_failure = exc
        planning_attempts = [dict(item) for item in exc.planning_attempts]
        execution_error = f"{type(exc).__name__}: {exc}"
    except CodeAgentPlanningError as exc:
        planning_attempts = [dict(item) for item in exc.attempts]
        execution_error = f"{type(exc).__name__}: {exc}"
    except Exception as exc:
        execution_error = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            task.teardown(env)
        except Exception:
            pass

    trace: list[dict[str, Any]] = []
    if outcome is not None:
        trace.append(
            {
                "decision": outcome.decision.decision,
                "reason": outcome.decision.reason,
                "code": outcome.decision.code,
                "output": _json_safe(outcome.output),
                "stdout": list(outcome.stdout),
                "raw_response": outcome.decision.raw_response,
                "planning_attempts": [
                    dict(item) for item in outcome.planning_attempts
                ],
            }
        )
    elif execution_failure is not None:
        trace.append(
            {
                "decision": execution_failure.decision.decision,
                "reason": execution_failure.decision.reason,
                "code": execution_failure.decision.code,
                "output": None,
                "stdout": [],
                "raw_response": execution_failure.decision.raw_response,
                "planning_attempts": planning_attempts,
            }
        )
    elif planning_attempts:
        trace.append(
            {
                "decision": "error",
                "reason": "model response failed parsing or validation",
                "code": "",
                "output": None,
                "stdout": [],
                "raw_response": planning_attempts[-1].get("raw_response", ""),
                "planning_attempts": planning_attempts,
            }
        )

    exec_result = ExecutionResult(
        steps=0 if outcome is None or outcome.decision.refused else 1,
        trace=trace,
        runtime_s=time.monotonic() - started,
        finished=execution_error is None,
        truncated=False,
        stop_reason=(
            ActionType.COMPLETE.value if execution_error is None else "ERROR"
        ),
        agent_message=(
            outcome.decision.reason
            if outcome is not None
            else (
                execution_failure.decision.reason
                if execution_failure is not None
                else None
            )
        ),
        error=execution_error,
    )

    judge = None
    if execution_error is None and initial_obs is not None and final_obs is not None:
        evaluator = Evaluator(judge_mode="state", eval_mode="text")
        try:
            judge = await evaluator.evaluate(
                task, initial_obs, final_obs, exec_result
            )
        except Exception as exc:
            exec_result = dataclasses.replace(
                exec_result,
                error=f"judge_error: {type(exc).__name__}: {exc}",
                stop_reason="ERROR",
                finished=False,
            )

    result = EpisodeResult(
        task_id=task.id,
        task_name=task.description,
        suite=task.suite,
        execution=exec_result,
        judge=judge,
        apps=list(task.apps),
        max_steps=1,
        require_complete=getattr(task, "require_complete", True),
        **EpisodeResult._task_taxonomy(task),
    ).to_dict()
    result["execution"]["trace"] = trace
    return result


_RETRYABLE_RUNTIME_ERRORS = (
    "__BENCH_STORES__",
    "Failed to fetch dynamically imported module",
    "Importing a module script failed",
    "Execution context was destroyed",
    "MobileJail Skill runtime is not ready",
    "Page.goto:",
    "Page.wait_for_function:",
    "Target page, context or browser has been closed",
    "net::ERR_CONNECTION",
    "reset failed after",
    "_wait_ready phase=",
    "Failed to fetch",
    "TimeoutError",
)


def _is_retryable_runtime_result(result: dict[str, Any]) -> bool:
    error = str(result.get("execution", {}).get("error") or "")
    return bool(error) and any(
        marker in error for marker in _RETRYABLE_RUNTIME_ERRORS
    )


def _is_repairable_agent_result(result: dict[str, Any]) -> bool:
    """Return true only for model-program failures, never judge failures.

    A repair receives the task prompt, prepared state, prior program and the
    Python/Skill exception.  It deliberately does not receive the judge's
    pass/fail details, so retrying cannot become verifier fitting.
    """
    error = str(result.get("execution", {}).get("error") or "")
    return error.startswith((
        "CodeAgentExecutionError:",
        "CodeAgentPlanningError:",
    ))


def _agent_repair_feedback(result: dict[str, Any]) -> str:
    execution = result.get("execution", {})
    trace = execution.get("trace") or []
    last = trace[-1] if trace else {}
    code = str(last.get("code") or "")
    error = str(execution.get("error") or "unknown execution error")
    return (
        "Previous program:\n"
        f"{code or '(no executable program was accepted)'}\n\n"
        f"Execution error:\n{error}"
    )[:16_000]


async def run_shard(
    descriptors: list[TaskDescriptor],
    config: dict[str, Any],
    *,
    progress_callback: Callable[[], None] | None = None,
) -> list[dict[str, Any]]:
    """Run one process shard with its own EnvPool and LLM clients."""
    if not descriptors:
        return []
    concurrency = min(
        len(descriptors),
        max(1, int(config.get("parallel", 1))),
    )
    env_pool = EnvPool(
        url=config["env_url"],
        n=concurrency,
        isolation=config.get("isolation", "pages"),
        num_browsers=min(
            concurrency,
            max(0, int(config.get("browsers", 0))),
        ),
        headless=bool(config.get("headless", True)),
        proxy=config.get("proxy"),
        delay_after_action=0.0,
        verbose=not bool(config.get("quiet", False)),
    )

    queue: asyncio.Queue[tuple[int, TaskDescriptor] | None] = asyncio.Queue()
    for index, descriptor in enumerate(descriptors):
        queue.put_nowait((index, descriptor))
    for _ in range(concurrency):
        queue.put_nowait(None)

    results: list[dict[str, Any] | None] = [None] * len(descriptors)

    def new_agent() -> CodeAgent:
        llm = LLMClient(
            base_url=config["model_base_url"],
            api_key=config.get("model_api_key") or None,
            model=config["model_name"],
            total_timeout_s=float(config.get("infer_timeout", 300.0)),
        )
        model_args = {
            "temperature": float(config.get("temperature", 0.0)),
            "top_p": float(config.get("top_p", 1.0)),
            "max_tokens": int(config.get("max_tokens", 4096)),
            "stream": False,
        }
        return CodeAgent(
            llm,
            model_args=model_args,
            code_timeout_s=float(config.get("code_timeout", 30.0)),
            plan_attempts=int(config.get("plan_attempts", 2)),
            review_attempts=int(config.get("review_attempts", 1)),
            state_context_chars=int(config.get("state_context_chars", 40_000)),
            force_execute=bool(config.get("force_execute", False)),
        )

    async def worker(worker_id: int) -> None:
        env = env_pool[worker_id]
        agent = new_agent()
        # EnvPool deliberately tolerates individual start errors for generic GUI
        # runners. CodeAgent requires stronger backends, so repair/validate every
        # worker before task-local preparation is injected.
        await asyncio.sleep(0.15 * (worker_id % 8))
        await agent.prepare_env(env)
        completed_tasks = 0
        while True:
            item = await queue.get()
            try:
                if item is None:
                    return
                index, descriptor = item
                if (
                    completed_tasks
                    and bool(config.get("fresh_context_per_task", True))
                ):
                    # ``BaseTask.setup()`` resets simulator state, but a Vite
                    # page can still retain failed lazy-import promises and
                    # module-level caches. A fresh context is therefore the
                    # default boundary between independent benchmark tasks.
                    await env.restart()
                    await agent.prepare_env(env)
                env.set_current_task(descriptor.task_id)
                runtime_retries = max(
                    0, int(config.get("runtime_retries", 2))
                )
                execution_repairs = max(
                    0, int(config.get("execution_repairs", 1))
                )
                runtime_retries_used = 0
                execution_repairs_used = 0
                repair_feedback = ""
                episode_attempts: list[dict[str, Any]] = []
                for episode_attempt in range(
                    1 + runtime_retries + execution_repairs
                ):
                    task = instantiate_task(
                        descriptor,
                        sample_seed=int(config.get("sample_seed", 0)),
                    )
                    # The feedback is produced solely from an earlier agent
                    # program and its public API exception.  It is not task
                    # metadata and does not contain the original judge output.
                    task._codeagent_repair_feedback = repair_feedback
                    result = await _run_episode(
                        env,
                        agent,
                        task,
                        episode_timeout_s=float(
                            config.get("episode_timeout", 180.0)
                        ),
                    )
                    episode_attempts.append(
                        {
                            "attempt": episode_attempt + 1,
                            "error": result.get("execution", {}).get("error"),
                            "runtime_retryable": _is_retryable_runtime_result(result),
                            "agent_repairable": _is_repairable_agent_result(result),
                        }
                    )
                    runtime_retryable = _is_retryable_runtime_result(result)
                    agent_repairable = _is_repairable_agent_result(result)
                    if runtime_retryable and runtime_retries_used < runtime_retries:
                        runtime_retries_used += 1
                        repair_feedback = ""
                        await env.restart()
                        await agent.prepare_env(env)
                        continue
                    if (
                        agent_repairable
                        and execution_repairs_used < execution_repairs
                    ):
                        execution_repairs_used += 1
                        repair_feedback = _agent_repair_feedback(result)
                        # The failed program may have performed an operation
                        # before raising. Rebuild the context before replaying
                        # task.setup(), so the repaired attempt cannot inherit
                        # partial side effects or a poisoned lazy module.
                        await env.restart()
                        await agent.prepare_env(env)
                        continue

                    result["execution"]["episode_attempts"] = episode_attempts
                    result["execution"]["runtime_retries_used"] = runtime_retries_used
                    result["execution"]["execution_repairs_used"] = execution_repairs_used
                    results[index] = result
                    completed_tasks += 1
                    if progress_callback is not None:
                        progress_callback()
                    break
            finally:
                queue.task_done()

    async with env_pool:
        await asyncio.gather(*(worker(i) for i in range(concurrency)))
    return [result for result in results if result is not None]


def write_results(
    run_dir: Path,
    results: list[dict[str, Any]],
    meta: dict[str, Any],
) -> dict[str, Any]:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    with (run_dir / "results.jsonl").open("w", encoding="utf-8") as handle:
        for result in results:
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")

    errors = sum(bool(item.get("is_error")) for item in results)
    valid = len(results) - errors
    successes = sum(bool(item.get("is_success")) for item in results)
    success_tasks = [item["id"] for item in results if item.get("is_success")]
    failed_tasks = [
        item["id"] for item in results
        if not item.get("is_success") and not item.get("is_error")
    ]
    error_tasks = [item["id"] for item in results if item.get("is_error")]
    summary = {
        "total": len(results),
        "valid": valid,
        "success": successes,
        "failed": max(0, valid - successes),
        "errors": errors,
        "success_rate": successes / max(1, valid),
        "success_tasks": success_tasks,
        "failed_tasks": failed_tasks,
        "error_tasks": error_tasks,
        "run_dir": str(run_dir),
    }
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return summary
