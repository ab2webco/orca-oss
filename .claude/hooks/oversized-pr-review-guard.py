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

# Why: macOS ships python3 3.9 at /usr/bin; `str | None` crashes there at import, the hook
# exits 1 and Claude Code runs the merge unchecked (ORCA-803).
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
from command_text import strip_heredocs  # noqa: E402

# Only a prefilter: the decision is made on the parsed command, never on this match.
PR_MERGE_HINT = re.compile(r"\bpr\s+merge\b")
# Why este token y no una frase libre: obliga a nombrar el lineage, que es lo que después
# se puede ir a leer. "corrí 4 lentes" no se puede verificar seis horas más tarde.
ACK_RE = re.compile(r"reviewed-4r:\s*(review-[0-9a-f]{8,})")
THRESHOLD = 400

# Why duplicado y no importado: la fuente es .github/scripts/pr-test-loc-table.mjs y este
# hook es Python. Los dos casos compartidos están cubiertos por el test de al lado.
TEST_DIR_SEGMENT = re.compile(r"(?:^|/)(?:__tests__|e2e|tests)(?:/|$)", re.IGNORECASE)
TEST_FILENAME = re.compile(r"\.(?:test|spec|e2e)\.[^/]+$", re.IGNORECASE)
# Why aparte de los tests: son tablas de strings, no producto. Un rename mueve miles
# de líneas de catálogo que se revisan por muestreo y por el gate de localización,
# no leyéndolas — contarlas como código hace que la guarda mida otra cosa que la
# que dice medir. Ver ORCA-397.
DATA_PATH = re.compile(
    r"(?:^|/)(?:test-doubles/|src/renderer/src/i18n/locales/)", re.IGNORECASE
)
# Why: lockfiles are package-manager output, not hand-written code. ORCA-781.
LOCKFILES = frozenset(
    {
        "package-lock.json",
        "npm-shrinkwrap.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lock",
        "bun.lockb",
        "Cargo.lock",
        "Gemfile.lock",
        "composer.lock",
        "poetry.lock",
        "Pipfile.lock",
        "uv.lock",
        "go.sum",
        "pubspec.lock",
        "Podfile.lock",
        "flake.lock",
    }
)

OPERATORS = {"&&", "||", ";", "|", "&", "(", ")"}
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
PREFIX_COMMANDS = {"sudo", "command", "nohup", "time", "env"}
CD_OPTIONS = {"-P", "-L", "-e", "-@", "--"}
# gh pr merge flags whose next argument is a value, not the PR selector.
MERGE_VALUE_FLAGS = {
    "-A",
    "--author-email",
    "-b",
    "--body",
    "-F",
    "--body-file",
    "-t",
    "--subject",
    "--match-head-commit",
}
PR_URL = re.compile(r"^https?://[^/]+/(?P<repo>[^/]+/[^/]+)/pull/(?P<number>\d+)")
REPO_SLUG = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


class MergeCall(NamedTuple):
    """One `gh pr merge` with the directory and GH_REPO it runs under."""

    directory: str | None
    env_repo: str | None
    args: list[str]


def is_test_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return bool(TEST_DIR_SEGMENT.search(normalized) or TEST_FILENAME.search(normalized))


def is_data_path(path: str) -> bool:
    return bool(DATA_PATH.search(path.replace("\\", "/")))


def is_lockfile(path: str) -> bool:
    return Path(path.replace("\\", "/")).name in LOCKFILES


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


def command_tokens(command: str) -> list[str]:
    # Why: bash ends a command at a newline, so the newline must split segments too.
    lexer = shlex.shlex(command.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def segments(tokens: list[str]) -> list[list[str]]:
    out: list[list[str]] = [[]]
    for token in tokens:
        if token in OPERATORS:
            out.append([])
        else:
            out[-1].append(token)
    return [s for s in out if s]


def strip_prefixes(segment: list[str]) -> tuple[dict[str, str], list[str]]:
    env: dict[str, str] = {}
    index = 0
    while index < len(segment):
        token = segment[index]
        if ASSIGNMENT.match(token):
            name, _, value = token.partition("=")
            env[name] = value
        elif token not in PREFIX_COMMANDS:
            break
        index += 1
    return env, segment[index:]


def cd_target(args: list[str], current: str | None) -> str | None:
    """Directory a `cd` leaves the shell in, or None when it cannot be known statically."""
    targets = [arg for arg in args if arg not in CD_OPTIONS]
    if current is None or len(targets) > 1:
        return None
    if not targets:
        return str(Path.home())
    target = targets[0]
    # Why: a shell variable or command substitution would have to be expanded to know the dir.
    if target == "-" or "$" in target or "`" in target:
        return None
    return os.path.normpath(os.path.join(current, os.path.expanduser(target)))


def merge_args(words: list[str]) -> list[str] | None:
    """Args of a `gh pr merge` call, gh's options in front included, or None if it is not one."""
    if not words or words[0] != "gh":
        return None
    rest = words[1:]
    for index in range(len(rest) - 1):
        if rest[index] == "pr" and rest[index + 1] == "merge":
            return rest[:index] + rest[index + 2 :]
    return None


def merge_calls(tokens: list[str], cwd: str) -> list[MergeCall]:
    calls: list[MergeCall] = []
    directory: str | None = cwd
    for segment in segments(tokens):
        env, words = strip_prefixes(segment)
        if words[:1] == ["cd"]:
            directory = cd_target(words[1:], directory)
            continue
        args = merge_args(words)
        if args is not None:
            calls.append(MergeCall(directory, env.get("GH_REPO"), args))
    return calls


def parse_merge_args(args: list[str]) -> tuple[str | None, str | None]:
    """The PR selector and the -R value of a `gh pr merge` argument list."""
    selector: str | None = None
    repo: str | None = None
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in {"-R", "--repo"}:
            repo = args[index + 1] if index + 1 < len(args) else ""
            index += 2
            continue
        if arg.startswith("--repo="):
            repo = arg.partition("=")[2]
        elif arg.startswith("-R"):
            repo = arg[2:]
        elif arg in MERGE_VALUE_FLAGS:
            index += 2
            continue
        elif not arg.startswith("-") and selector is None:
            selector = arg
        index += 1
    return selector, repo


def repo_slug(value: str) -> str | None:
    """owner/repo from `owner/repo`, `HOST/owner/repo` or a repo URL, or None."""
    tail = value.strip().rstrip("/").removesuffix(".git").split("/")
    slug = "/".join(tail[-2:])
    return slug if REPO_SLUG.match(slug) else None


def directory_repo(directory: str | None) -> str | None:
    """The repo gh resolves for this checkout, which is the one `gh pr merge` acts on there."""
    if directory is None:
        return None
    code, out = run(
        ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], directory
    )
    return repo_slug(out) if code == 0 else None


def pr_number(repo: str, directory: str) -> str | None:
    """Number of the PR on the current branch of `directory`, looked up in `repo`."""
    code, out = run(
        ["gh", "pr", "view", "-R", repo, "--json", "number", "-q", ".number"], directory
    )
    return out if code == 0 and out.isdigit() else None


def authored_additions(number: str, repo: str, directory: str | None) -> int | None:
    # Why `gh api --paginate` y no `gh pr view --json files`: ese corta en 100
    # entradas sin decirlo, así que un PR ancho se reporta por su primera página.
    # Medido en #293: 100 de 1021 archivos, 432 líneas en vez de 1847 — la guarda
    # subcontaba justo la clase de PR que existe para frenar. ORCA-411.
    #
    # Why 90s y no los 20 de run(): son ~11 páginas para 1021 archivos. El costo de
    # rate limit se paga una vez por intento de merge, que es raro; a cambio, el
    # número es del PR y no de su primer pedazo.
    code, out = run(
        [
            "gh",
            "api",
            "--paginate",
            f"repos/{repo}/pulls/{number}/files",
            "--jq",
            ".[] | [.filename, (.additions|tostring)] | @tsv",
        ],
        directory,
        timeout=90,
    )
    # Fail-closed: sin lista no hay medición, y el caller deniega. No caer a la
    # fuente truncada — un número menor que el real es peor que ninguno.
    if code != 0 or not out:
        return None
    total = 0
    for line in out.splitlines():
        path, _, additions = line.partition("\t")
        if not path or is_test_path(path) or is_data_path(path) or is_lockfile(path):
            continue
        try:
            total += int(additions or 0)
        except ValueError:
            return None
    return total


UNRESOLVED_REPO = (
    "oversized-pr-review-guard: no se pudo resolver el repositorio de este `gh pr merge`, "
    "así que no se midió el tamaño de su PR. El comando se deja pasar; pasá `-R owner/repo` "
    "para que la guarda lo mida."
)
UNRESOLVED_NUMBER = (
    "oversized-pr-review-guard: no se pudo resolver el número del PR, así que no se "
    "puede medir su tamaño.\n\n"
    "Pasá el número explícito (`gh pr merge <n>`), o si de verdad no aplica, agregá "
    "`# reviewed-4r: <lineage>` con el receipt que respalda este merge."
)


def check_call(call: MergeCall, ack: re.Match[str] | None) -> str | None:
    """A note for an allowed oversized merge, or None when the merge is under the threshold."""
    selector, flag = parse_merge_args(call.args)
    url = PR_URL.match(selector or "")
    # Why fail closed: un selector de rama no se mapea a un número sin consultar, y medir
    # el PR de la rama actual puede ser otro PR.
    if selector is not None and not url and not selector.isdigit():
        deny(UNRESOLVED_NUMBER)

    explicit = url.group("repo") if url else flag if flag is not None else call.env_repo
    repo = repo_slug(explicit) if explicit is not None else directory_repo(call.directory)
    if repo is None:
        return UNRESOLVED_REPO

    number = url.group("number") if url else selector
    if number is None:
        if call.directory is None:
            return UNRESOLVED_REPO
        number = pr_number(repo, call.directory)
    if number is None:
        deny(UNRESOLVED_NUMBER)

    added = authored_additions(number, repo, call.directory)
    if added is None:
        deny(
            f"oversized-pr-review-guard: no se pudo leer el diff del PR #{number}, así que no "
            "se puede medir su tamaño.\n\n"
            "Una guarda que no puede medir y deja pasar es la que no estaba. Reintentá, o "
            "agregá `# reviewed-4r: <lineage>` si ya verificaste el review a mano."
        )

    if added <= THRESHOLD:
        return None

    if ack:
        return (
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


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    command = strip_heredocs((payload.get("tool_input") or {}).get("command") or "")
    if not PR_MERGE_HINT.search(command):
        sys.exit(0)

    try:
        tokens = command_tokens(command)
    except ValueError:
        # Why fail closed: un comando ilegible que nombra un merge no se asume inocente.
        deny(
            "oversized-pr-review-guard: no se pudo parsear el comando (comillas sin cerrar) "
            "para saber si mergea un PR."
        )
        return

    ack = ACK_RE.search(command)
    notes: list[str] = []
    for call in merge_calls(tokens, payload.get("cwd") or os.getcwd()):
        message = check_call(call, ack)
        if message:
            notes.append(message)
    if notes:
        note("\n".join(notes))
    sys.exit(0)


if __name__ == "__main__":
    main()
