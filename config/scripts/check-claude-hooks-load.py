#!/usr/bin/env python3
"""Load every Python file in .claude/hooks on this interpreter and name each one that fails.

Why two modes: Claude Code runs only the hooks registered in .claude/settings.json; any other file
there is a helper the hooks import, and run as a script it may exit non-zero by design
(orca_cli.py exits 1 when it finds no CLI, which kept the hook suites from running: ORCA-1038).
"""

import json
import re
import subprocess
import sys
from pathlib import Path

TIMEOUT_S = 60
IMPORT_ONLY = (
    "import runpy, sys; sys.path.insert(0, sys.argv[2]); "
    "runpy.run_path(sys.argv[1], run_name='claude_hook_helper')"
)


def registered_commands(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "command" and isinstance(value, str):
                yield value
            else:
                yield from registered_commands(value)
    elif isinstance(node, list):
        for item in node:
            yield from registered_commands(item)


def is_registered(name, commands):
    pattern = re.compile(r"\.claude/hooks/" + re.escape(name) + r"(?![\w.-])")
    return any(pattern.search(command) for command in commands)


def main(argv):
    project = Path(argv[1] if len(argv) > 1 else ".").resolve()
    hooks_dir = project / ".claude" / "hooks"
    settings = json.loads((project / ".claude" / "settings.json").read_text(encoding="utf-8"))
    commands = list(registered_commands(settings))
    failures = []
    hooks_run = 0
    for path in sorted(hooks_dir.glob("*.py")):
        rel = path.relative_to(project).as_posix()
        if is_registered(path.name, commands):
            kind, args = "hook", [sys.executable, str(path)]
            hooks_run += 1
        else:
            kind, args = "helper", [sys.executable, "-c", IMPORT_ONLY, str(path), str(hooks_dir)]
        try:
            # Why empty stdin: a hook reads its event there, and an empty one must not crash it.
            code = subprocess.run(
                args, cwd=project, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                timeout=TIMEOUT_S,
            ).returncode
            outcome = "ok" if code == 0 else f"exited {code}"
        except subprocess.TimeoutExpired:
            outcome = f"timed out after {TIMEOUT_S}s"
        print(f"{kind:6} {rel}: {outcome}", flush=True)
        if outcome != "ok":
            failures.append(rel)
            how = "run on empty stdin" if kind == "hook" else "imported"
            print(f"::error file={rel}::{rel} {outcome} when {how}", flush=True)
    # Why: if registration stops matching, every hook would only be imported and the check would pass vacuously.
    if hooks_run == 0:
        print("::error::no .claude/hooks/*.py is registered in .claude/settings.json", flush=True)
        return 1
    if failures:
        print(f"{len(failures)} failed on Python {sys.version.split()[0]}: {', '.join(failures)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
