#!/usr/bin/env python3
"""Antes de un commit o push, dice en voz alta dónde va a aterrizar.

Why: en esta sesión se commitearon 5 commits creyendo que iban a `main` cuando
iban a una rama de feature, y se reportó "mergeado a main" siendo falso. El
worktree no anuncia su rama, y `git status` no se mira antes de cada commit.
Esto no bloquea: sólo hace imposible no verlo.
"""

import json
import subprocess
import sys


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=15
        ).stdout.strip()
    except Exception:
        return ""


def main() -> None:
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
