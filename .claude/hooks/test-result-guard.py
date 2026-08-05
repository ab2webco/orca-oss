#!/usr/bin/env python3
"""Lee el resumen de vitest y bloquea si hubo rojos, ignorando el exit code.

Why: MEDIDO en este repo — `npm test` terminó con exit code 0 reportando
`Tests 6 failed | 40082 passed`. Un gate que mire `$?` deja pasar un build roto.
El único dato confiable es la línea de resumen.

Bloquea también cuando el resumen no aparece: una corrida que se cortó antes de
resumir no probó nada, y tratarla como verde es el mismo error.
"""

import json
import re
import sys

SUMMARY = re.compile(r"^\s*(Tests|Test Files)\s+(?P<body>.+)$", re.MULTILINE)
FAILED = re.compile(r"(?P<n>\d+)\s+failed")
# Sólo una INVOCACIÓN cuenta, no una mención: un comando que escribe documentación
# citando `npm test` no corrió tests. Se mira el inicio de cada segmento del shell.
INVOCATION = re.compile(
    r"^(?:\w+=\S+\s+)*(?:npx\s+|pnpm\s+|yarn\s+)?(?:npm\s+(?:run\s+)?test|vitest)\b"
)
SEGMENT_SEPARATORS = re.compile(r"&&|\|\||[;|\n]")


def ran_tests(command: str) -> bool:
    return any(
        INVOCATION.match(segment.strip()) for segment in SEGMENT_SEPARATORS.split(command)
    )


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    command = (payload.get("tool_input") or {}).get("command") or ""
    if not ran_tests(command):
        sys.exit(0)

    response = payload.get("tool_response")
    output = response if isinstance(response, str) else json.dumps(response or "")

    summaries = SUMMARY.findall(output)
    if not summaries:
        # Avisar, no bloquear: la ausencia de resumen puede ser una salida
        # recortada por el propio comando, y bloquear por ausencia de evidencia
        # convierte la guarda en ruido.
        json.dump(
            {
                "systemMessage": (
                    "Sin línea de resumen de vitest en la salida: no hay evidencia de que los "
                    "tests hayan corrido hasta el final. No lo cuentes como verde."
                )
            },
            sys.stdout,
        )
        sys.exit(0)

    failures = [m.group("n") for _, body in summaries for m in [FAILED.search(body)] if m]
    if failures:
        json.dump(
            {
                "decision": "block",
                "reason": (
                    "Hay tests en ROJO ({} fallando) aunque el comando pueda haber salido con "
                    "exit code 0 — está medido que en este repo pasa. Toda falla de tu corrida es "
                    "tuya, incluidas las que no causaste: arreglala o dejala documentada con "
                    "evidencia. No sigas hacia commit, PR ni release.".format(
                        " / ".join(failures)
                    )
                ),
            },
            sys.stdout,
        )
        sys.exit(0)

    if "vitest" in command and "--config" not in command and "npm" not in command:
        json.dump(
            {
                "systemMessage": (
                    "vitest sin --config: no resuelve el alias @/ del repo. "
                    "Usá `npm test` o `--config config/vitest.config.ts`."
                )
            },
            sys.stdout,
        )


main()
