#!/usr/bin/env python3
"""Mueve a Done el ticket que un `gh pr merge` acaba de entregar.

Why: el harness mira el board al ENTRAR —`board-state-guard` exige un ticket In
Progress para abrir el PR— y nunca al salir. MEDIDO: 11 tickets en In Progress y
8 con su PR ya mergeado (ORCA-471). Recordarlo no alcanzó; esto lo hace.

Nunca bloquea: es higiene, no una compuerta. Un fallo acá no puede costar un merge.
"""

import json
import re
import subprocess
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from command_text import strip_heredocs  # noqa: E402

PROJECT_ID = "e665c0d5-22e7-495e-9ecf-3effee3ae370"
TICKET = re.compile(r"ORCA-(\d+)", re.IGNORECASE)

# Posición de comando, no `\b`: un `echo "gh pr merge 12"` no mergeó nada. Es el
# mismo falso positivo que ORCA-432 le costó a board-state-guard.
MERGE = re.compile(r"(?:^|[;&|(]|&&|\|\||\n)\s*(?:\w+=\S+\s+)*gh\s+pr\s+merge\s+(\d+)")


def run(args: list[str], timeout: int = 15) -> str | None:
    try:
        done = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def merged_ticket(pr: str) -> str | None:
    """El ticket del PR, sólo si el PR está realmente mergeado.

    Why releerlo: el comando pudo fallar o ser denegado, y cerrar un ticket sobre
    un merge que no ocurrió deja el board mintiendo en la dirección contraria.
    """
    raw = run(["gh", "pr", "view", pr, "--json", "state,title"])
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    if data.get("state") != "MERGED":
        return None
    found = TICKET.search(data.get("title") or "")
    return f"ORCA-{found.group(1)}" if found else None


def close(ticket: str, pr: str) -> bool:
    run(
        ["orca", "plane", "comment", "add", "--id", ticket, "--project", PROJECT_ID,
         "--body", f"Entregado en #{pr}, mergeado."]
    )
    return run(
        ["orca", "plane", "status", "set", "--id", ticket, "--project", PROJECT_ID,
         "--to", "Done"]
    ) is not None


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    command = strip_heredocs((payload.get("tool_input") or {}).get("command") or "")
    prs = MERGE.findall(command)
    if not prs:
        sys.exit(0)

    notes = []
    for pr in prs:
        ticket = merged_ticket(pr)
        if ticket is None:
            continue
        notes.append(
            f"board: {ticket} → Done por #{pr}"
            if close(ticket, pr)
            else f"board: no pude mover {ticket} a Done — movelo a mano"
        )

    if notes:
        print(json.dumps({"systemMessage": " · ".join(notes)}))
    sys.exit(0)


if __name__ == "__main__":
    main()
