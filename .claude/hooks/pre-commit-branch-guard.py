#!/usr/bin/env python3
"""Antes de un commit o push, dice en voz alta dónde va a aterrizar.

Why: en esta sesión se commitearon 5 commits creyendo que iban a `main` cuando
iban a una rama de feature, y se reportó "mergeado a main" siendo falso. El
worktree no anuncia su rama, y `git status` no se mira antes de cada commit.
Esto no bloquea: sólo hace imposible no verlo.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from command_text import strip_heredocs  # noqa: E402

# Why: la nota salia en cada comando, dos veces, porque el hook leia la rama sin mirar el
# comando. Impresa siempre, la vez que dice "NO es main" se lee igual que las doscientas que
# no dijeron nada — una guarda que habla siempre dejo de avisar (ORCA-375).
COMMIT_OR_PUSH = re.compile(r"\bgit\s+(?:commit|push)\b")


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=15
        ).stdout.strip()
    except Exception:
        return ""


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    command = strip_heredocs((payload.get("tool_input") or {}).get("command") or "")
    if not COMMIT_OR_PUSH.search(command):
        sys.exit(0)

    branch = git("branch", "--show-current") or "DETACHED HEAD"
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") or "sin upstream"
    parts = [f"rama: {branch}", f"upstream: {upstream}"]

    if branch != "DETACHED HEAD" and upstream != "sin upstream":
        counts = git("rev-list", "--left-right", "--count", f"{upstream}...{branch}")
        if counts:
            behind, ahead = (counts.split() + ["?", "?"])[:2]
            parts.append(f"{ahead} sin subir, {behind} sin traer")

    note = " · ".join(parts)
    if branch == "DETACHED HEAD":
        note += "  ⚠️  un commit acá no queda en ninguna rama"
    elif branch != "main":
        note += "  ⚠️  NO es main: para llegar a main hace falta PR o merge explícito"

    json.dump({"systemMessage": note}, sys.stdout)


main()
