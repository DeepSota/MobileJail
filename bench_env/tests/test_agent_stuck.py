"""单元测试：GenericAgentV2 agent-side stuck detection (action-only).

覆盖：
- 同一动作连续重复 N=5 次 → ABORT ("agent_stuck_action_loop")
- threshold 可配置（默认 5）
- warning hint 在 streak = threshold-1 时注入并 one-shot 消费
- reset() 清空状态
- 不同动作不触发 abort
- abort step 不调用 LLM 以外的副作用

(原 route-based 检测在 mobile UI 上误杀过重 —— 短信/聊天/转账页天然就会
有 3-5 步同 route 多步操作。已删除，仅保留动作指纹检测。)
"""
from __future__ import annotations

from typing import Any

import pytest

from bench_env.agent.base import AgentConfig
from bench_env.agent.generic_v2 import GenericAgentV2, StuckReason
from bench_env.env.base import Action, ActionType, Observation
from bench_env.llm.openai_chat import ChatResult


def _obs(step_idx: int, app: str = "demo", path: str = "/") -> Observation:
    return Observation(
        screenshot_base64="",
        route={"app": app, "path": path},
        state={},
        step_idx=step_idx,
    )


class _FakeLLM:
    """假 LLM：按预设序列返回响应，记录调用次数。"""

    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.calls: int = 0

    def chat(self, *, messages: list[dict[str, Any]], args: Any = None) -> ChatResult:
        idx = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return ChatResult(content=self._responses[idx])


# ---------------------------------------------------------------------------
# 1. 动作卡死 → ABORT（默认 threshold=5）
# ---------------------------------------------------------------------------
def test_action_stuck_aborts_at_threshold_5() -> None:
    """LLM 连续 5 次返回同一 CLICK → 第 5 步 ABORT。
    路由每步变化（避免历史 aspect 干扰，新设计不看 route）。"""
    same_response = '<ANSWER>{"action": "CLICK", "point": [500, 500]}</ANSWER>'
    llm = _FakeLLM([same_response] * 5)
    agent = GenericAgentV2(llm=llm)  # 默认 stuck_threshold=5
    agent.reset("test task")

    actions = [
        agent.act(_obs(i, app="demo", path=f"/page{i}"))
        for i in range(1, 6)
    ]

    # 前 4 步正常 CLICK
    for i in range(4):
        assert actions[i].action_type == ActionType.CLICK
    # 第 5 步 ABORT
    assert actions[4].action_type == ActionType.ABORT
    assert actions[4].data["value"] == StuckReason.ACTION_LOOP.value
    # action-stuck 是 post-LLM，第 5 步会调 LLM 再判定
    assert llm.calls == 5


# ---------------------------------------------------------------------------
# 2. 不同动作不触发 abort
# ---------------------------------------------------------------------------
def test_no_abort_when_actions_differ() -> None:
    """5 步动作都不同 → 不 abort，全部正常返回。"""
    responses = [
        '<ANSWER>{"action": "CLICK", "point": [100, 100]}</ANSWER>',
        '<ANSWER>{"action": "CLICK", "point": [200, 200]}</ANSWER>',
        '<ANSWER>{"action": "TYPE", "value": "hello"}</ANSWER>',
        '<ANSWER>{"action": "SWIPE", "point1": [500, 800], "point2": [500, 200]}</ANSWER>',
        '<ANSWER>{"action": "BACK"}</ANSWER>',
    ]
    llm = _FakeLLM(responses)
    agent = GenericAgentV2(llm=llm)
    agent.reset("test task")

    actions = [agent.act(_obs(i, app="demo", path="/")) for i in range(1, 6)]

    assert all(a.action_type != ActionType.ABORT for a in actions)
    assert llm.calls == 5


# ---------------------------------------------------------------------------
# 3. warning hint 在 streak = threshold-1 时注入到下一步 prompt
# ---------------------------------------------------------------------------
def test_warning_hint_injected_at_streak_threshold_minus_one() -> None:
    """stuck_threshold=5 → 第 4 步结束后 streak=4 == threshold-1，set hint。
    hint 在第 5 步的 build_messages 里被消费到 user_text。"""
    same_response = '<ANSWER>{"action": "CLICK", "point": [500, 500]}</ANSWER>'
    # 前 4 步同 action 触发 hint；第 5 步我们传一个不同 action 来避免 abort
    # 这样可以孤立验证 hint 注入逻辑
    responses = [
        same_response,
        same_response,
        same_response,
        same_response,
        '<ANSWER>{"action": "CLICK", "point": [999, 999]}</ANSWER>',  # 不同动作，避免 abort
    ]
    llm = _FakeLLM(responses)
    agent = GenericAgentV2(llm=llm)  # threshold=5
    agent.reset("test task")

    # 第 1-3 步：streak 还没到 4，hint 不应被 set
    for i in range(1, 4):
        agent.act(_obs(i, app="demo", path="/"))
    # act() 内 build_messages 立即消费了 hint（如果 set 了），所以 act() 返回后
    # _stuck_hint_message 通常已被消费为空。这里通过 history[-1].llm_prompt 验证。

    # 第 4 步：streak=4 == threshold-1，set hint。但 hint 在这一步的 act() 内
    # 被 set 后还没被消费（build_messages 已在 set 之前调用过了）。
    # 所以第 4 步结束后 _stuck_hint_message 应该非空，等第 5 步 build_messages 消费。
    agent.act(_obs(4, app="demo", path="/"))
    assert "连续重复" in agent._stuck_hint_message

    # 第 5 步：build_messages 应把 hint 注入到当前步 user_text 并清空 hint
    agent.act(_obs(5, app="demo", path="/"))

    # 验证第 5 步的 prompt user_text 包含 hint
    last_prompt = agent.history[-1].llm_prompt
    last_user = next(
        m for m in reversed(last_prompt)
        if m["role"] == "user" and isinstance(m["content"], list)
    )
    user_text = last_user["content"][-1]["text"]
    assert "连续重复" in user_text
    assert agent._stuck_hint_message == ""  # one-shot 已消费


# ---------------------------------------------------------------------------
# 4. reset() 清空状态
# ---------------------------------------------------------------------------
def test_reset_clears_state() -> None:
    """reset() → action_fp_deque 与 hint 都清空。"""
    same_response = '<ANSWER>{"action": "CLICK", "point": [100, 100]}</ANSWER>'
    llm = _FakeLLM([same_response] * 4)
    agent = GenericAgentV2(llm=llm)
    agent.reset("first task")

    # 走 4 步让 deque 填上，hint 也 set 上
    for i in range(1, 5):
        agent.act(_obs(i, app="demo", path="/"))
    assert agent._action_fp_deque  # 非空
    assert agent._stuck_hint_message  # 已 set hint（streak=4 == threshold-1）

    agent.reset("second task")
    assert len(agent._action_fp_deque) == 0
    assert agent._stuck_hint_message == ""


# ---------------------------------------------------------------------------
# 5. threshold 可配置
# ---------------------------------------------------------------------------
def test_threshold_config() -> None:
    """stuck_threshold=3 → 第 3 步 abort。"""
    same_response = '<ANSWER>{"action": "CLICK", "point": [500, 500]}</ANSWER>'
    llm = _FakeLLM([same_response] * 3)
    agent = GenericAgentV2(llm=llm, config=AgentConfig(stuck_threshold=3))
    agent.reset("test task")

    actions = [agent.act(_obs(i, app="demo", path="/")) for i in range(1, 4)]

    assert actions[0].action_type == ActionType.CLICK
    assert actions[1].action_type == ActionType.CLICK
    assert actions[2].action_type == ActionType.ABORT
    assert actions[2].data["value"] == StuckReason.ACTION_LOOP.value


# ---------------------------------------------------------------------------
# 6. ABORT step 仍 emit 合法 Action，runner 能正确终止
# ---------------------------------------------------------------------------
def test_abort_action_is_terminal() -> None:
    """emit 的 ABORT action 应是 terminal，runner 会据 stop_reason 终止。"""
    same_response = '<ANSWER>{"action": "CLICK", "point": [500, 500]}</ANSWER>'
    llm = _FakeLLM([same_response] * 5)
    agent = GenericAgentV2(llm=llm, config=AgentConfig(stuck_threshold=3))
    agent.reset("test task")

    a1 = agent.act(_obs(1))
    a2 = agent.act(_obs(2))
    a3 = agent.act(_obs(3))

    assert a3.action_type == ActionType.ABORT
    assert a3.is_terminal is True  # env/base.py:236
    # thought 含 reason，方便排查
    assert "agent_stuck_action_loop" in a3.thought
    # abort step 在 history 里留 stub 记录
    assert agent.history[-1].action.action_type == ActionType.ABORT
    assert agent.history[-1].llm_response == ""  # abort step 没调 LLM 拿 hint text