#!/usr/bin/env python3
"""Antes de abrir o mergear un PR, exige que su ticket esté en el estado que le toca.

Why: el board es la fuente de trabajo y se quedó atrás mientras se trabajaba. En una
sesión se abrieron y mergearon PRs con su ticket todavía en Backlog, se crearon seis
tickets que nadie movió, y uno cerrado por un merge siguió abierto. Ninguna de esas
tres cosas se ve desde la terminal, así que recordarlas no funcionó: `orca plane` no
falla cuando el estado está mal, simplemente no se llama.

No bloquea el trabajo: bloquea *anunciarlo* con el board desalineado. La salida de
emergencia es explícita (`no-ticket:`) para que saltarse la regla deje dicho por qué.
"""

import json
import re
import subprocess
import sys

PROJECT_ID = "e665c0d5-22e7-495e-9ecf-3effee3ae370"
TICKET_RE = re.compile(r"ORCA-(\d+)", re.IGNORECASE)
CREATE_RE = re.compile(r"\bgh\s+pr\s+create\b")
MERGE_RE = re.compile(r"\bgh\s+pr\s+merge\b")
OPT_OUT_RE = re.compile(r"no-ticket:\s*(\S.*)")
REQUIRED_STATE = "In Progress"


def deny(detail: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": detail,
            }
        },
        sys.stdout,
    )
    sys.exit(0)


def note(message: str) -> None:
    json.dump({"systemMessage": message}, sys.stdout)
    sys.exit(0)


def run(args: list[str], cwd: str | None, timeout: int = 20) -> tuple[int, str]:
    try:
        done = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return done.returncode, done.stdout.strip()
    except Exception:
        return 1, ""


def ticket_from(command: str, cwd: str | None) -> str | None:
    # Why the branch before the command: a PR body can quote another ticket in
    # prose, and the branch is what actually carries the work.
    code, branch = run(["git", "branch", "--show-current"], cwd)
    for source in ([branch] if code == 0 and branch else []) + [command]:
        found = TICKET_RE.search(source)
        if found:
            return f"ORCA-{found.group(1)}"
    return None


def board_state(ticket: str, cwd: str | None) -> str | None:
    code, out = run(
        ["orca", "plane", "issue", "--id", ticket, "--project", PROJECT_ID, "--json"], cwd
    )
    if code != 0 or not out:
        return None
    try:
        payload = json.loads(out)
    except ValueError:
        return None
    if payload.get("ok") is not True:
        return None
    item = (payload.get("result") or {}).get("workItem") or {}
    state = item.get("state")
    return state.get("name") if isinstance(state, dict) else None


def fix_command(ticket: str, target: str) -> str:
    return f'orca plane status set --id {ticket} --project {PROJECT_ID} --to "{target}"'


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    command = (payload.get("tool_input") or {}).get("command") or ""
    creating = bool(CREATE_RE.search(command))
    merging = bool(MERGE_RE.search(command))
    if not creating and not merging:
        sys.exit(0)

    cwd = payload.get("cwd")
    opt_out = OPT_OUT_RE.search(command)
    if opt_out:
        note(f"board: sin ticket por decisión explícita — {opt_out.group(1).strip()}")

    ticket = ticket_from(command, cwd)
    if not ticket:
        deny(
            "Ni la rama ni el comando nombran un ticket ORCA-<n>, así que no se puede "
            "comprobar que este trabajo esté en el board.\n\n"
            "El board es la fuente de trabajo: si no está ahí, creá el ticket antes de "
            "abrir el PR.\n\n"
            f'  orca plane create --project {PROJECT_ID} --title "..." --body-file <ruta>\n\n'
            "Si de verdad este PR no lleva ticket, decí por qué en el comando: "
            "agregá `# no-ticket: <razón>`."
        )

    state = board_state(ticket, cwd)
    if state is None:
        deny(
            f"No se pudo leer el estado de {ticket} en el board.\n\n"
            "Se rechaza en vez de asumir que está bien: un board ilegible y un board "
            "desalineado se ven igual desde acá.\n\n"
            f"  orca plane issue --id {ticket} --project {PROJECT_ID} --json\n\n"
            "Si el board está caído y el PR no puede esperar, agregá "
            "`# no-ticket: board inaccesible` al comando."
        )

    if merging:
        if state == "Done":
            note(f"board: {ticket} ya está en Done.")
        note(
            f"board: {ticket} está en «{state}». Después de mergear, movelo:\n  "
            + fix_command(ticket, "Done")
        )

    if state != REQUIRED_STATE:
        deny(
            f"{ticket} está en «{state}» y este PR lo está trabajando.\n\n"
            f"El board tiene que decir la verdad mientras el trabajo pasa, no después. "
            f"Movelo y volvé a abrir el PR:\n\n  {fix_command(ticket, REQUIRED_STATE)}"
        )

    note(f"board: {ticket} en «{state}» — al mergear, movelo a Done.")


main()
