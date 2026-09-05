#!/usr/bin/env python3
"""Antes de mergear un PR grande, exige nombrar el receipt de review que lo respalda.

Why: MEDIDO — en ORCA-340 dirigí una tajada que salió en 1663 líneas y escribí "una sola
ronda de review" en su brief. La ronda 1 encontró blockers, y autoricé la 2, la 3 y la 4 en
vez de cortar. Cuatro rondas, ningún receipt hasta el final, y el PR creció a 2125 líneas
mientras yo llamaba "corte" a cada paso. Cada ronda encontró algo real: a ese tamaño el
review no converge, y la respuesta es un candidato más chico, no más pasadas.

El umbral de 400 líneas ya está escrito en dos lugares — el skill `chained-pr` y el tiering
de las reglas de agente — y las dos veces es texto que un coordinador cansado se pasa por
alto. Esto lo convierte en una parada.

No es un gate infalsificable: el token de escape se puede escribir sin haber corrido nada,
igual que `no-ticket:`. Lo único infalsificable vive del lado del servidor (ver ORCA-370).
Lo que esto compra es que saltárselo sea un acto deliberado que deja dicho contra qué
lineage, en vez de una deriva de cuatro rondas que nadie nombra.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from command_text import strip_heredocs  # noqa: E402

MERGE_RE = re.compile(r"\bgh\s+pr\s+merge\b")
MERGE_NUMBER_RE = re.compile(r"\bgh\s+pr\s+merge\s+(\d+)")
# Why este token y no una frase libre: obliga a nombrar el lineage, que es lo que después
# se puede ir a leer. "corrí 4 lentes" no se puede verificar seis horas más tarde.
ACK_RE = re.compile(r"reviewed-4r:\s*(review-[0-9a-f]{8,})")
THRESHOLD = 400

# Why duplicado y no importado: la fuente es .github/scripts/pr-test-loc-table.mjs y este
# hook es Python. Los dos casos compartidos están cubiertos por el test de al lado.
TEST_DIR_SEGMENT = re.compile(r"(?:^|/)(?:__tests__|e2e|tests)(?:/|$)", re.IGNORECASE)
TEST_FILENAME = re.compile(r"\.(?:test|spec|e2e)\.[^/]+$", re.IGNORECASE)


def is_test_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return bool(TEST_DIR_SEGMENT.search(normalized) or TEST_FILENAME.search(normalized))


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


def pr_number(command: str, cwd: str | None) -> str | None:
    found = MERGE_NUMBER_RE.search(command)
    if found:
        return found.group(1)
    # Why: `gh pr merge` sin número resuelve por la rama actual.
    code, out = run(["gh", "pr", "view", "--json", "number", "-q", ".number"], cwd)
    return out if code == 0 and out else None


def authored_additions(number: str, cwd: str | None) -> int | None:
    code, out = run(
        ["gh", "pr", "view", number, "--json", "files", "-q", ".files"], cwd, timeout=30
    )
    if code != 0 or not out:
        return None
    try:
        files = json.loads(out)
    except ValueError:
        return None
    if not isinstance(files, list):
        return None
    total = 0
    for entry in files:
        path = entry.get("path") or ""
        if not path or is_test_path(path):
            continue
        total += int(entry.get("additions") or 0)
    return total


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    command = strip_heredocs((payload.get("tool_input") or {}).get("command") or "")
    if not MERGE_RE.search(command):
        sys.exit(0)

    cwd = payload.get("cwd")
    ack = ACK_RE.search(command)

    number = pr_number(command, cwd)
    if not number:
        # Why fail closed: una guarda que no puede medir y deja pasar es la que no estaba.
        deny(
            "oversized-pr-review-guard: no se pudo resolver el número del PR, así que no se "
            "puede medir su tamaño.\n\n"
            "Pasá el número explícito (`gh pr merge <n>`), o si de verdad no aplica, agregá "
            "`# reviewed-4r: <lineage>` con el receipt que respalda este merge."
        )

    added = authored_additions(number, cwd)
    if added is None:
        deny(
            f"oversized-pr-review-guard: no se pudo leer el diff del PR #{number}, así que no "
            "se puede medir su tamaño.\n\n"
            "Una guarda que no puede medir y deja pasar es la que no estaba. Reintentá, o "
            "agregá `# reviewed-4r: <lineage>` si ya verificaste el review a mano."
        )

    if added <= THRESHOLD:
        sys.exit(0)

    if ack:
        note(
            f"review: PR #{number} con {added} líneas propias (sin tests) mergeado contra el "
            f"lineage {ack.group(1)}."
        )

    deny(
        f"oversized-pr-review-guard: el PR #{number} suma {added} líneas propias sin contar "
        f"tests, por encima de las {THRESHOLD} que piden el set 4R completo.\n\n"
        "Why: en ORCA-340 un PR de este tamaño pasó por cuatro rondas de review y cada una "
        "encontró algo real — a ese tamaño el review no converge, y la respuesta es un "
        "candidato más chico, no más pasadas.\n\n"
        "Dos salidas, y la primera es la buena:\n"
        "  1. Cortar la tajada. Lo que no está probado sale en el PR siguiente, con su ticket.\n"
        "  2. Si el 4R sí corrió y hay receipt, nombralo en el comando:\n"
        "     gh pr merge <n> --squash  # reviewed-4r: review-xxxxxxxx\n\n"
        "Los receipts viven en .git/gentle-ai/review-transactions/v2/<lineage>/. "
        "Buscá uno con terminal_state approved y cuatro entradas en selected_lenses; si no "
        "existe, este PR no tuvo el review que su tamaño pide."
    )


if __name__ == "__main__":
    main()
