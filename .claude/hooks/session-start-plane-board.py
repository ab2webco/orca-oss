#!/usr/bin/env python3
"""Inyecta el board de Plane al abrir sesión.

Why: el board es la fuente de las tareas. Cuando no está en contexto se olvida,
se trabaja de memoria y el board queda describiendo un estado que ya no existe.
"""

import json
import subprocess
import sys

from orca_cli import resolve_orca_cli

ORCA_PROJECT_ID = "e665c0d5-22e7-495e-9ecf-3effee3ae370"
# Sólo lo que está en vuelo o en cola; el backlog completo es ruido al arrancar.
SHOWN_STATES = ("In Progress", "Todo")
PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
MAX_TODO_ROWS = 30
# Why: Claude Code recorta el contexto de un hook a 10.000 caracteres sin avisar; el margen es para los títulos de sección.
MAX_CONTEXT_CHARS = 9000
MAX_REASON_CHARS = 200
HEADER = "# Board de Plane — Orca Lab. Ésta es la fuente de las tareas."
FOOTER = (
    "Leé el ticket con `orca plane issue <id> --comments` antes de tocar código. "
    "Si el trabajo no está acá, creá el ticket primero. "
    "Al cambiar de estado usá `orca plane status set`."
)
LIST_COMMAND = '`orca plane list --project {} --state "{{}}"`'.format(ORCA_PROJECT_ID)


def emit(context: str) -> None:
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


def unread(reason: str) -> None:
    """Why: un fallo callado se lee como un board vacío, y la sesión concluye que no hay trabajo."""
    reason = " ".join(reason.split())[:MAX_REASON_CHARS]
    emit(
        "# Board de Plane: NO se pudo leer ({}).\n"
        "Esto no dice nada de lo que hay en el board: consultalo con {}.".format(
            reason, LIST_COMMAND.format("Todo")
        )
    )


def read_items() -> list:
    cli = resolve_orca_cli()
    if cli is None:
        unread("no hay CLI de Orca que sea seguro ejecutar")
    # Why sin --filter ni --limit: el filtro por defecto da los abiertos, y --limit corta antes
    # de separar estados. `everything` además suma todo lo cerrado a la respuesta (ORCA-919).
    command = [cli, "plane", "list", "--project", ORCA_PROJECT_ID, "--json"]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=45)
    except (OSError, subprocess.SubprocessError) as error:
        unread(str(error))
    try:
        payload = json.loads(done.stdout)
    except ValueError:
        unread(done.stderr.strip() or "no se pudo interpretar la respuesta")
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict) and error.get("message"):
        unread(str(error["message"]))
    items = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        unread("no se pudo interpretar la respuesta")
    return items


def row(item: dict) -> str:
    return "- **{}** [{}] {}".format(
        item.get("identifier"),
        item.get("priority") or "none",
        (item.get("title") or "").strip(),
    )


def main() -> None:
    by_state: dict = {state: [] for state in SHOWN_STATES}
    for item in read_items():
        state = (item.get("state") or {}).get("name")
        if state in by_state:
            by_state[state].append(item)
    if not any(by_state.values()):
        emit("# Board de Plane — Orca Lab: sin tickets en In Progress ni Todo.")

    lines = [HEADER, ""]
    used = len(HEADER) + len(FOOTER)
    for state in SHOWN_STATES:
        rows = sorted(by_state[state], key=lambda i: PRIORITY_RANK.get(i.get("priority"), 5))
        if not rows:
            continue
        lines.append("## {} ({})".format(state, len(rows)))
        cap = MAX_TODO_ROWS if state == "Todo" else len(rows)
        shown = 0
        for item in rows[:cap]:
            line = row(item)
            used += len(line) + 1
            if used > MAX_CONTEXT_CHARS:
                break
            lines.append(line)
            shown += 1
        hidden = len(rows) - shown
        if hidden:
            lines.append(
                "- … {} más sin mostrar de {}: {}".format(
                    hidden, len(rows), LIST_COMMAND.format(state)
                )
            )
        lines.append("")
    lines.append(FOOTER)
    emit("\n".join(lines))


main()
