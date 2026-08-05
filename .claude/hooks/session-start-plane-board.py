#!/usr/bin/env python3
"""Inyecta el board de Plane al abrir sesión.

Why: el board es la fuente de las tareas. Cuando no está en contexto se olvida,
se trabaja de memoria y el board queda describiendo un estado que ya no existe.
"""

import json
import shutil
import subprocess
import sys

ORCA_PROJECT_ID = "e665c0d5-22e7-495e-9ecf-3effee3ae370"
# Sólo lo que está en vuelo o en cola; el backlog completo es ruido al arrancar.
SHOWN_STATES = ("In Progress", "Todo")
PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3, "none": 4}


def emit(context: str) -> None:
    if context:
        json.dump(
            {
                "hookSpecificOutput": {
                    "hookEventName": "SessionStart",
                    "additionalContext": context,
                }
            },
            sys.stdout,
        )
    sys.exit(0)


def main() -> None:
    if shutil.which("orca") is None:
        emit("")
    try:
        raw = subprocess.run(
            [
                "orca", "plane", "list",
                "--project", ORCA_PROJECT_ID,
                "--filter", "everything",
                "--limit", "100",
                "--json",
            ],
            capture_output=True,
            text=True,
            timeout=45,
        ).stdout
        items = json.loads(raw).get("result")
    except Exception:
        emit("")
    if not isinstance(items, list):
        emit("")

    by_state: dict[str, list[dict]] = {state: [] for state in SHOWN_STATES}
    for item in items:
        state = (item.get("state") or {}).get("name")
        if state in by_state:
            by_state[state].append(item)
    if not any(by_state.values()):
        emit("")

    lines = ["# Board de Plane — Orca Lab. Ésta es la fuente de las tareas.", ""]
    for state in SHOWN_STATES:
        rows = sorted(by_state[state], key=lambda i: PRIORITY_RANK.get(i.get("priority"), 5))
        if not rows:
            continue
        lines.append("## {} ({})".format(state, len(rows)))
        for item in rows:
            lines.append(
                "- **{}** [{}] {}".format(
                    item.get("identifier"),
                    item.get("priority") or "none",
                    (item.get("title") or "").strip(),
                )
            )
        lines.append("")
    lines.append(
        "Leé el ticket con `orca plane issue <id> --comments` antes de tocar código. "
        "Si el trabajo no está acá, creá el ticket primero. "
        "Al cambiar de estado usá `orca plane status set`."
    )
    emit("\n".join(lines))


main()
