#!/usr/bin/env python3
"""validate_adv_task.py — lint generated bench_env/adv_task0/ task classes.

Enforces the hard rules in references/adv_task_spec.md. Run after generating
or editing any task under bench_env/adv_task0/. The skill's SKILL.md §7 lists
this script as the deterministic gate.

Usage:
    python Z-Jailbreak_Construction_SKILL/scripts/validate_adv_task.py
    python Z-Jailbreak_Construction_SKILL/scripts/validate_adv_task.py --suite adv_task0
    python Z-Jailbreak_Construction_SKILL/scripts/validate_adv_task.py --suite jailbreak_json
    python Z-Jailbreak_Construction_SKILL/scripts/validate_adv_task.py --fix-hints  # print fix hints, no auto-fix

Exit codes:
    0 — all checks passed
    1 — repository layout error (suite missing, etc.)
    2 — one or more rule violations found
    3 — internal error
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
ADV_TASK_DIR = REPO_ROOT / "bench_env" / "adv_task0"
TEST_SUITE = "adv_task0"


# ---------------------------------------------------------------------------
# Rule definitions. Each rule is (id, severity, description, check_fn).
# severity is "error" (must fix) or "warn" (review).
# ---------------------------------------------------------------------------

class Violation:
    def __init__(self, rule_id: str, severity: str, file: Path, lineno: int, msg: str):
        self.rule_id = rule_id
        self.severity = severity
        self.file = file
        self.lineno = lineno
        self.msg = msg

    def format(self) -> str:
        loc = f"{self.file.relative_to(REPO_ROOT)}:{self.lineno}"
        return f"[{self.severity.upper()}] {self.rule_id} {loc} — {self.msg}"


REQUIRED_TASK_ATTRS = {
    "templates", "apps", "scope", "objective", "composition",
    "difficulty", "capabilities", "parameters", "expected_changes",
}

VALID_DIFFICULTIES = {"L1", "L2", "L3", "L4"}
VALID_OBJECTIVES = {"operate"}
VALID_COMPOSITIONS = {"atomic"}
VALID_SCOPES_SINGLE = {"S1"}
VALID_SCOPES_MULTI = {"S2"}


def _get_class_bases(node: ast.ClassDef) -> list[str]:
    out: list[str] = []
    for b in node.bases:
        if isinstance(b, ast.Name):
            out.append(b.id)
        elif isinstance(b, ast.Attribute):
            # e.g. adv_task.tasks.AdvBaseTask
            out.append(getattr(b, "attr", ""))
    return out


def _get_attr_names(node: ast.ClassDef) -> dict[str, ast.AST]:
    """Return {attr_name: node} for top-level class attribute assignments."""
    out: dict[str, ast.AST] = {}
    for stmt in node.body:
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            target = stmt.targets[0]
            if isinstance(target, ast.Name):
                out[target.id] = stmt
    return out


def check_task_class(file_path: Path, cls_node: ast.ClassDef, violations: list[Violation]) -> None:
    bases = _get_class_bases(cls_node)
    is_adv = any(b == "AdvBaseTask" for b in bases)

    # AdvBaseTask itself inherits BaseTask — that's correct, skip it.
    if cls_node.name == "AdvBaseTask":
        return

    # Rule R-001: inherit from AdvBaseTask
    if not is_adv:
        if any(b == "BaseTask" for b in bases):
            violations.append(Violation(
                "R-001", "error", file_path, cls_node.lineno,
                f"class {cls_node.name!r} inherits BaseTask directly — must inherit AdvBaseTask from bench_env.adv_task0.tasks",
            ))
        # If it's not AdvBaseTask or BaseTask, it's probably a helper — skip.
        return

    attrs = _get_attr_names(cls_node)

    # Rule R-002: required attributes
    missing = REQUIRED_TASK_ATTRS - attrs.keys()
    if missing:
        violations.append(Violation(
            "R-002", "error", file_path, cls_node.lineno,
            f"class {cls_node.name!r} missing required attribute(s): {sorted(missing)}",
        ))

    # Rule R-003: objective == "operate"
    obj_node = attrs.get("objective")
    if obj_node and isinstance(obj_node, ast.Assign):
        val = obj_node.value
        if isinstance(val, ast.Constant) and val.value != "operate":
            violations.append(Violation(
                "R-003", "error", file_path, obj_node.lineno,
                f"objective must be 'operate' (got {val.value!r})",
            ))

    # Rule R-004: composition == "atomic"
    comp_node = attrs.get("composition")
    if comp_node and isinstance(comp_node, ast.Assign):
        val = comp_node.value
        if isinstance(val, ast.Constant) and val.value != "atomic":
            violations.append(Violation(
                "R-004", "error", file_path, comp_node.lineno,
                f"composition must be 'atomic' for adv_task (got {val.value!r})",
            ))

    # Rule R-005: difficulty in {L1..L4}
    diff_node = attrs.get("difficulty")
    if diff_node and isinstance(diff_node, ast.Assign):
        val = diff_node.value
        if isinstance(val, ast.Constant) and val.value not in VALID_DIFFICULTIES:
            violations.append(Violation(
                "R-005", "error", file_path, diff_node.lineno,
                f"difficulty must be one of {sorted(VALID_DIFFICULTIES)} (got {val.value!r})",
            ))

    # Rule R-006: scope matches len(apps)
    apps_node = attrs.get("apps")
    scope_node = attrs.get("scope")
    if apps_node and scope_node and isinstance(apps_node, ast.Assign) and isinstance(scope_node, ast.Assign):
        apps_val = apps_node.value
        scope_val = scope_node.value
        if isinstance(apps_val, ast.List) and isinstance(scope_val, ast.Constant):
            n_apps = sum(1 for e in apps_val.elts if isinstance(e, ast.Constant))
            scope = scope_val.value
            expected_scope = "S2" if n_apps >= 2 else "S1"
            if scope != expected_scope:
                violations.append(Violation(
                    "R-006", "error", file_path, scope_node.lineno,
                    f"scope={scope!r} but apps has {n_apps} entries — expected scope={expected_scope!r}",
                ))

    # Rule R-007: expected_changes == []
    ec_node = attrs.get("expected_changes")
    if ec_node and isinstance(ec_node, ast.Assign):
        val = ec_node.value
        if isinstance(val, ast.List) and len(val.elts) > 0:
            violations.append(Violation(
                "R-007", "error", file_path, ec_node.lineno,
                "expected_changes must be empty for adv_task — AdvBaseTask.evaluate() forces clean=True",
            ))

    # Rule R-008: parameters is empty (adv_task does not sample)
    param_node = attrs.get("parameters")
    if param_node and isinstance(param_node, ast.Assign):
        val = param_node.value
        if isinstance(val, ast.Dict) and len(val.keys) > 0:
            violations.append(Violation(
                "R-008", "error", file_path, param_node.lineno,
                f"parameters must be empty (adv_task does not sample); got {len(val.keys)} entries",
            ))

    # Rule R-009: require_complete not overridden
    for stmt in cls_node.body:
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            if isinstance(stmt.targets[0], ast.Name) and stmt.targets[0].id == "require_complete":
                violations.append(Violation(
                    "R-009", "error", file_path, stmt.lineno,
                    "do not override require_complete — AdvBaseTask already sets it False",
                ))

    # Rule R-010: capabilities non-empty
    cap_node = attrs.get("capabilities")
    if cap_node and isinstance(cap_node, ast.Assign):
        val = cap_node.value
        if isinstance(val, ast.List) and len(val.elts) == 0:
            violations.append(Violation(
                "R-010", "error", file_path, cap_node.lineno,
                "capabilities must be non-empty (adv_task always has 'safety')",
            ))
        elif isinstance(val, ast.List):
            cap_strs = []
            for e in val.elts:
                if isinstance(e, ast.Constant):
                    cap_strs.append(str(e.value))
            if "safety" not in cap_strs:
                violations.append(Violation(
                    "R-010", "warn", file_path, cap_node.lineno,
                    "capabilities should include 'safety' for adv_task",
                ))

    # Rule R-011: templates is non-empty list
    tpl_node = attrs.get("templates")
    if tpl_node and isinstance(tpl_node, ast.Assign):
        val = tpl_node.value
        if isinstance(val, ast.List) and len(val.elts) == 0:
            violations.append(Violation(
                "R-011", "error", file_path, tpl_node.lineno,
                "templates must be non-empty (adv_task needs the verbatim prompt)",
            ))

    # Rule R-012: check_goals defined
    has_check_goals = False
    for stmt in cls_node.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)) and stmt.name == "check_goals":
            has_check_goals = True
            # Rule R-013: check_goals must have a return statement
            has_return = any(isinstance(n, ast.Return) for n in ast.walk(stmt))
            if not has_return:
                violations.append(Violation(
                    "R-013", "error", file_path, stmt.lineno,
                    "check_goals() must return list[dict] with 'passed' field — no return found",
                ))
    if not has_check_goals:
        violations.append(Violation(
            "R-012", "error", file_path, cls_node.lineno,
            f"class {cls_node.name!r} does not define check_goals()",
        ))

    # Rule R-014: no module-level helper functions in the file
    # (checked at file-scope below)


def suite_py_files(suite_dir: Path) -> list[Path]:
    """Return only files the task registry actually loads for a suite."""
    files = []
    for name in ("__init__.py", "app.py", "tasks.py"):
        path = suite_dir / name
        if path.exists():
            files.append(path)
    defs_dir = suite_dir / "defs"
    if defs_dir.exists():
        files.extend(sorted(p for p in defs_dir.glob("*.py") if not p.name.startswith("_")))
    return files


def resolve_suite_dir(suite: str) -> Path:
    direct = REPO_ROOT / "bench_env" / suite
    if direct.exists():
        return direct
    generated = REPO_ROOT / "bench_env" / "generated_task" / suite
    if generated.exists():
        return generated
    return direct


def check_file(file_path: Path, violations: list[Violation]) -> None:
    """Run all per-file rules."""
    text = file_path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(text, filename=str(file_path))
    except SyntaxError as e:
        violations.append(Violation(
            "R-000", "error", file_path, e.lineno or 0,
            f"SyntaxError: {e.msg}",
        ))
        return

    # R-014: no module-level helper / non-class definitions
    is_task_source = file_path.name == "tasks.py" or file_path.parent.name == "defs"
    for stmt in tree.body:
        if is_task_source and isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            violations.append(Violation(
                "R-014", "error", file_path, stmt.lineno,
                f"module-level function {stmt.name!r}() not allowed — task files contain only Task classes",
            ))
        # R-015: no `(x or {}).get(...)` chains at module scope (cheap heuristic on raw text)
    # Cheap regex check across the whole file body
    defensive_re = re.compile(r"\(\s*\w+\s+or\s+\{\}\s*\)\.get\(")
    for m in defensive_re.finditer(text):
        lineno = text.count("\n", 0, m.start()) + 1
        violations.append(Violation(
            "R-015", "warn", file_path, lineno,
            "(x or {}).get(...) defensive chain — index input.apps[...] directly",
        ))

    # R-016: forbidden datetime usage
    forbidden_dt_re = re.compile(r"\b(datetime|time)\.today\(\)|datetime\.now\(\)|time\.time\(\)")
    for m in forbidden_dt_re.finditer(text):
        lineno = text.count("\n", 0, m.start()) + 1
        # Only flag if it's not inside a comment line
        line = text.splitlines()[lineno - 1]
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        violations.append(Violation(
            "R-016", "error", file_path, lineno,
            "datetime.now()/time.time() forbidden — use TimeService if a timestamp is needed",
        ))

    # R-017: Sms(input.apps["sms"]) — wrong data layer
    sms_wrong_re = re.compile(r'Sms\(\s*input\.apps\[\s*"sms"\s*\]')
    for m in sms_wrong_re.finditer(text):
        lineno = text.count("\n", 0, m.start()) + 1
        line = text.splitlines()[lineno - 1]
        if line.lstrip().startswith("#"):
            continue
        violations.append(Violation(
            "R-017", "error", file_path, lineno,
            'Sms(input.apps["sms"]) reads only settings, not conversations — use sms_from_input(input)',
        ))

    # R-018: AdvXxx.get_list("chatThreads") — Reddit dict trap
    chatthreads_re = re.compile(r'\.get_list\(\s*"chatThreads"\s*\)')
    for m in chatthreads_re.finditer(text):
        lineno = text.count("\n", 0, m.start()) + 1
        line = text.splitlines()[lineno - 1]
        if line.lstrip().startswith("#"):
            continue
        violations.append(Violation(
            "R-018", "error", file_path, lineno,
            'get_list("chatThreads") returns [] for dicts — use Reddit(...).new_chat_messages_to(username)',
        ))

    # R-019: AdvContacts(input.apps["contacts"]) — wrong data layer
    contacts_wrong_re = re.compile(r'AdvContacts\(\s*input\.apps\[\s*"contacts"\s*\]')
    for m in contacts_wrong_re.finditer(text):
        lineno = text.count("\n", 0, m.start()) + 1
        line = text.splitlines()[lineno - 1]
        if line.lstrip().startswith("#"):
            continue
        violations.append(Violation(
            "R-019", "error", file_path, lineno,
            'AdvContacts(input.apps["contacts"]) may read empty data — contacts live in os.providers.contacts',
        ))

    # Walk classes
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            check_task_class(file_path, node, violations)


def check_task_order(violations: list[Violation]) -> None:
    """R-100: TASK_ORDER entries are unique, zero-padded, monotonic."""
    init_path = ADV_TASK_DIR / "__init__.py"
    if not init_path.exists():
        violations.append(Violation(
            "R-100", "error", init_path, 0,
            f"{init_path.relative_to(REPO_ROOT)} not found",
        ))
        return
    text = init_path.read_text(encoding="utf-8")
    matches = re.findall(r"""['"](T\d{4}_\w+)['"]""", text)
    seen: set[str] = set()
    last_num = 0
    for m in matches:
        if m in seen:
            violations.append(Violation(
                "R-100", "error", init_path, 0,
                f"duplicate TASK_ORDER entry: {m!r}",
            ))
        seen.add(m)
        num = int(m[1:5])
        if num <= last_num:
            violations.append(Violation(
                "R-100", "warn", init_path, 0,
                f"TASK_ORDER entry {m!r} is not strictly increasing (last={last_num})",
            ))
        last_num = max(last_num, num)


def check_test_matrix(violations: list[Violation]) -> None:
    """R-200: each task class has one positive + one negative offline case."""
    test_path = REPO_ROOT / "bench_env" / "tests" / TEST_SUITE / "test_tasks.py"
    if not test_path.exists():
        violations.append(Violation(
            "R-200", "warn", test_path, 0,
            f"bench_env/tests/{TEST_SUITE}/test_tasks.py not found — offline judge matrix missing",
        ))
        return
    text = test_path.read_text(encoding="utf-8")

    # Collect task class names from adv_task suite
    adv_task_classes: set[str] = set()
    for py_file in suite_py_files(ADV_TASK_DIR):
        if py_file.name == "__init__.py":
            continue
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                # Heuristic: only treat classes whose name starts with T<NNNN>_
                if re.match(r"^T\d{4}_", node.name):
                    adv_task_classes.add(node.name)

    if not adv_task_classes:
        return  # nothing to check

    pos_block = re.search(
        r"OFFLINE_JUDGE_POSITIVE_CASES\s*=\s*\[(?P<body>[^\]]*)\]",
        text,
        re.DOTALL,
    )
    neg_block = re.search(
        r"OFFLINE_JUDGE_NEGATIVE_CASES\s*=\s*\[(?P<body>[^\]]*)\]",
        text,
        re.DOTALL,
    )
    pos_entries: set[str] = set()
    neg_entries: set[str] = set()
    if pos_block:
        pos_entries = set(re.findall(r"""['"](T\d{4}_\w+)['"]""", pos_block.group("body")))
    if neg_block:
        neg_entries = set(re.findall(r"""['"](T\d{4}_\w+)['"]""", neg_block.group("body")))

    for cls_name in sorted(adv_task_classes):
        if cls_name not in pos_entries:
            violations.append(Violation(
                "R-200", "warn", test_path, 0,
                f"missing POSITIVE case for {cls_name}",
            ))
        if cls_name not in neg_entries:
            violations.append(Violation(
                "R-200", "warn", test_path, 0,
                f"missing NEGATIVE case for {cls_name}",
            ))


def check_no_nested_duplicate_suites(violations: list[Violation]) -> None:
    """R-300: adv_task0 must not contain stale nested suite copies."""
    if ADV_TASK_DIR.name != "adv_task0":
        return
    for name in ("adv_task", "adv_task0"):
        nested = ADV_TASK_DIR / name
        if nested.exists():
            violations.append(Violation(
                "R-300", "error", nested, 0,
                f"stale nested suite copy found: {nested.relative_to(REPO_ROOT)}",
            ))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated/adv jailbreak task classes against the adv_task spec.")
    parser.add_argument("--suite", default="adv_task0", help="Suite directory name (default: adv_task0)")
    parser.add_argument("--fix-hints", action="store_true", help="Print fix hints alongside violations (informational)")
    args = parser.parse_args()

    global ADV_TASK_DIR, TEST_SUITE
    TEST_SUITE = args.suite
    suite_dir = resolve_suite_dir(args.suite)
    ADV_TASK_DIR = suite_dir
    if not suite_dir.exists():
        print(f"ERROR: suite directory not found: {suite_dir}", file=sys.stderr)
        return 1

    violations: list[Violation] = []

    # Collect only files imported by the task registry.
    py_files = suite_py_files(suite_dir)
    for py in py_files:
        # Skip __init__.py to avoid double-checking TASK_ORDER later — we
        # validate TASK_ORDER separately. But still lint it for forbidden
        # patterns etc.
        if py.name == "__init__.py":
            check_file(py, violations)
            continue
        check_file(py, violations)

    check_task_order(violations)
    check_test_matrix(violations)
    check_no_nested_duplicate_suites(violations)

    if not violations:
        print(f"OK: no violations across {len(py_files)} file(s).")
        return 0

    errors = [v for v in violations if v.severity == "error"]
    warns = [v for v in violations if v.severity == "warn"]
    print(f"{'=' * 60}")
    print(f"Found {len(errors)} error(s) and {len(warns)} warning(s).")
    print(f"{'=' * 60}")
    for v in violations:
        print(v.format())
        if args.fix_hints:
            hint = _fix_hint(v.rule_id)
            if hint:
                print(f"    FIX: {hint}")
    return 2 if errors else 0


def _fix_hint(rule_id: str) -> str:
    return {
        "R-001": "Change `class T0xxx_(BaseTask)` to `class T0xxx_(AdvBaseTask)` and import from bench_env.adv_task0.tasks.",
        "R-002": "Add the missing class attributes. See references/adv_task_spec.md §2.",
        "R-003": "Set `objective = \"operate\"`. adv_task only does operate, never query/hybrid.",
        "R-004": "Set `composition = \"atomic\"`. adv_task tasks are 1-2 steps.",
        "R-005": "Set `difficulty` to one of L1/L2/L3/L4. See references/adv_task_spec.md §3.",
        "R-006": "scope=\"S1\" for single-app, scope=\"S2\" for apps with 2+ entries.",
        "R-007": "Set `expected_changes = []`. AdvBaseTask.evaluate() forces clean=True regardless.",
        "R-008": "Set `parameters = {}`. adv_task does not use parameter sampling — the prompt text is fixed.",
        "R-009": "Remove the `require_complete` line. AdvBaseTask already sets it False.",
        "R-010": "Add 'safety' to capabilities: `capabilities = [\"safety\", \"social\"]`.",
        "R-011": "Add `templates = [\"<exact prompt text>\"]` — the verbatim prompt the agent sees.",
        "R-012": "Define `def check_goals(self, input: JudgeInput) -> list[dict]: ...`.",
        "R-013": "check_goals() must `return [...]` — each dict has field/expected/actual/passed.",
        "R-014": "Move the helper function into a `check_*` method on the appropriate Adv* app class in app.py.",
        "R-015": "Index input.apps[...] directly; raise on missing data via the App accessor.",
        "R-016": "Use TimeService.now() / TimeService.realNow() instead of datetime.now() / time.time().",
        "R-100": "Check bench_env/adv_task0/__init__.py — TASK_ORDER entries must be unique and monotonically increasing.",
        "R-017": 'SMS conversations live in os.providers.sms — use sms_from_input(input) from bench_env.task.sms.app.',
        "R-018": 'Reddit chatThreads is a dict — use Reddit(...).new_chat_messages_to(username) instead of get_list.',
        "R-019": 'Contacts live in os.providers.contacts — read input.os["providers"]["contacts"] directly.',
        "R-200": "Add matching (\"<TaskName>\", _<taskname>_positive) and _negative entries to bench_env/tests/<suite>/test_tasks.py.",
        "R-300": "Remove stale nested directories under bench_env/adv_task0; only bench_env/adv_task0 itself is authoritative.",
    }.get(rule_id, "")


if __name__ == "__main__":
    sys.exit(main())
