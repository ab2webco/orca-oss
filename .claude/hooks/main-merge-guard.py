#!/usr/bin/env python3
"""Rechaza merges a `main` fuera de la sesión del workspace primario."""

import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from command_text import strip_heredocs  # noqa: E402

PROTECTED_BRANCH = "main"
PROJECT_SLUG = "ab2webco/orca-oss"

# Why: si el comando ni menciona un merge, no hay nada que parsear ni que resolver.
# Sin `\b` al final: cubre `merge`, `merges` y `mergePullRequest` de una sola vez.
# `refs/heads/main` entra aparte: mover la ref por la API no dice "push" ni "merge".
MERGE_HINT = re.compile(r"\b(?:push|merge)|refs/heads/" + PROTECTED_BRANCH)

OPERATORS = {"&&", "||", ";", "|", "&"}
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
PREFIX_COMMANDS = {"sudo", "command", "nohup", "time", "env"}

# Why: `git push -o ci.skip main` — la opción se come el valor siguiente, y si no se
# saltea, `ci.skip` se leería como refspec y `main` se perdería.
PUSH_VALUE_FLAGS = {"-o", "--push-option", "--receive-pack", "--exec"}

# Why: en este repo hay comandos que arrancan con opciones globales antes del
# subcomando (`git -c maintenance.auto=false fetch`). Mirar segment[1] a secas
# dejaría pasar `git -C otro/worktree push origin main`.
GIT_GLOBAL_VALUE_FLAGS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace"}

PULL_MERGE_ENDPOINT = re.compile(r"pulls/\d+/merge")
GIT_REF_ENDPOINT = re.compile(r"git/refs(?:/heads)?/" + PROTECTED_BRANCH)
# Why: `gh api` sin flags de cuerpo es un GET. Leer la ref de `main` no la mueve.
MUTATING_API = re.compile(
    r"(?:^|\s)(?:-X|--method)[= ](?:PATCH|POST|PUT|DELETE)|(?:^|\s)(?:-f|-F|--field|--raw-field|--input)\b",
    re.IGNORECASE,
)

REFUSAL = (
    "main-merge-guard (.claude/hooks/main-merge-guard.py) rechaza este merge a "
    "`{branch}`.\n\n"
    "{detail}\n\n"
    "Ningún agente mergea a `{branch}` desde la Bash tool, sin importar lo que diga su "
    "brief: el PR #73 se mergeó solo teniendo escrito lo contrario. Verde en PR Checks "
    "tampoco alcanza — E2E no corre en PRs (ORCA-196) y hoy es lo único que caza "
    "regresiones de runtime.\n\n"
    "Qué hacer en su lugar: pushear la rama, abrir o actualizar el PR, y avisar al "
    "coordinador con el número. El merge lo hace él, después de verificar."
)


def deny(detail: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": REFUSAL.format(
                    branch=PROTECTED_BRANCH, detail=detail
                ),
            }
        },
        sys.stdout,
    )
    sys.exit(0)


def resolved_git_path(value: str, cwd: str) -> Path:
    path = Path(value)
    return (path if path.is_absolute() else Path(cwd) / path).resolve()


def is_coordinator_workspace(workspace_id: str | None) -> bool:
    """El coordinador pertenece al worktree primario del proyecto, parado en `main`."""
    repo_id, separator, workspace = (workspace_id or "").partition("::")
    if not repo_id or not separator or not workspace:
        return False
    workspace = re.sub(r"::workspace:[0-9a-f-]{36}$", "", workspace, flags=re.IGNORECASE)
    wsl = re.match(
        r"^//(?:wsl\.localhost|wsl\$)/[^/]+(?P<path>/.*)?$", workspace.replace("\\", "/"), re.IGNORECASE
    ) if os.name != "nt" else None
    workspace = (wsl.group("path") or "/") if wsl else workspace
    code, common = run(["git", "rev-parse", "--git-common-dir"], workspace)
    if code != 0:
        return False
    code, own = run(["git", "rev-parse", "--git-dir"], workspace)
    if code != 0 or resolved_git_path(own, workspace) != resolved_git_path(common, workspace):
        return False
    code, branch = run(["git", "branch", "--show-current"], workspace)
    if code != 0 or branch != PROTECTED_BRANCH:
        return False
    # Why: la URL evita que otro repo primario en `main` obtenga autoridad.
    code, origin_url = run(["git", "remote", "get-url", "origin"], workspace)
    return code == 0 and PROJECT_SLUG in origin_url


def run(args: list[str], cwd: str | None) -> tuple[int, str]:
    try:
        done = subprocess.run(
            args, cwd=cwd or None, capture_output=True, text=True, timeout=12
        )
        return done.returncode, done.stdout.strip()
    except Exception:
        return 1, ""


def segments(tokens: list[str]) -> list[list[str]]:
    out: list[list[str]] = [[]]
    for token in tokens:
        if token in OPERATORS:
            out.append([])
        else:
            out[-1].append(token)
    return [s for s in out if s]


def strip_prefixes(segment: list[str]) -> list[str]:
    index = 0
    while index < len(segment) and (
        ASSIGNMENT.match(segment[index]) or segment[index] in PREFIX_COMMANDS
    ):
        index += 1
    return segment[index:]


def git_push_args(segment: list[str]) -> list[str] | None:
    """Args de `git push` salteando las opciones globales, o None si no es un push."""
    index = 1
    while index < len(segment):
        token = segment[index]
        if token in GIT_GLOBAL_VALUE_FLAGS:
            index += 2
            continue
        if token.startswith("-"):
            index += 1
            continue
        return segment[index + 1 :] if token == "push" else None
    return None


def is_own_remote(remote: str, cwd: str | None) -> bool:
    """`origin` y cualquier alias que apunte a la misma URL. Ante la duda, sí."""
    if remote == "origin":
        return True
    code, url = run(["git", "remote", "get-url", remote], cwd)
    if code != 0 or not url:
        # Why: un remoto que no resuelve puede ser una URL cruda del propio repo.
        return True
    code, origin_url = run(["git", "remote", "get-url", "origin"], cwd)
    return code != 0 or url == origin_url


def push_targets_protected(args: list[str], cwd: str | None) -> str | None:
    """Devuelve el porqué del rechazo, o None si el push no toca `main`."""
    positional: list[str] = []
    sweeping: str | None = None
    skip_next = False
    for arg in args:
        if skip_next:
            skip_next = False
            continue
        if arg in PUSH_VALUE_FLAGS:
            skip_next = True
            continue
        if arg in {"--all", "--mirror"}:
            sweeping = arg
            continue
        if arg.startswith("-"):
            continue
        positional.append(arg)

    remote = positional[0] if positional else "origin"
    refspecs = positional[1:] if positional else []

    if not is_own_remote(remote, cwd):
        return None

    if sweeping:
        return f"`git push {sweeping}` incluye `{PROTECTED_BRANCH}` entre las ramas que sube."

    if not refspecs:
        # Why: `git push` pelado sube la rama actual; sólo importa si es `main`.
        code, branch = run(["git", "branch", "--show-current"], cwd)
        if code == 0 and branch == PROTECTED_BRANCH:
            return f"Un `git push` sin refspec estando en `{PROTECTED_BRANCH}` sube `{PROTECTED_BRANCH}`."
        return None

    for refspec in refspecs:
        source, _colon, destination = refspec.lstrip("+").partition(":")
        target = (destination or source).removeprefix("refs/heads/")
        # Why: `git push origin HEAD` sin destino escribe la rama actual, y es la forma
        # más común de subir. Sin resolverla, `HEAD` parado en `main` pasaba derecho.
        if not destination and target in {"HEAD", "@"}:
            code, branch = run(["git", "branch", "--show-current"], cwd)
            target = branch if code == 0 else ""
        if target == PROTECTED_BRANCH:
            return f"El refspec `{refspec}` escribe `{PROTECTED_BRANCH}` en `{remote}`."
    return None


def pr_base_ref(args: list[str], cwd: str | None) -> str | None:
    """Base del PR que `gh pr merge` mergearía, o None si no se pudo resolver."""
    view = ["gh", "pr", "view"]
    selector_taken = False
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in {"--repo", "-R"} and index + 1 < len(args):
            view += [arg, args[index + 1]]
            index += 2
            continue
        if arg.startswith("--repo="):
            view.append(arg)
        elif not arg.startswith("-") and not selector_taken:
            view.append(arg)
            selector_taken = True
        index += 1
    view += ["--json", "baseRefName", "--jq", ".baseRefName"]
    code, base = run(view, cwd)
    return base if code == 0 and base else None


def check_gh(args: list[str], cwd: str | None, raw: str) -> None:
    if args[:2] == ["pr", "merge"]:
        base = pr_base_ref(args[2:], cwd)
        if base is None:
            # Why: fallar cerrado. Un `gh pr view` que no responde no es permiso.
            deny(
                "No se pudo resolver la rama base de este PR, así que no hay forma de "
                f"descartar que sea `{PROTECTED_BRANCH}`."
            )
        if base == PROTECTED_BRANCH:
            deny(f"Este PR tiene base `{base}`.")
        return

    if args and args[0] == "api":
        if "mergePullRequest" in raw:
            deny("La mutación `mergePullRequest` de la API GraphQL mergea el PR igual que la CLI.")
        if PULL_MERGE_ENDPOINT.search(raw) or re.search(r"/merges\b", raw):
            deny("Este `gh api` pega contra el endpoint de merge de la API REST.")
        if GIT_REF_ENDPOINT.search(raw) and MUTATING_API.search(raw):
            deny(
                f"Este `gh api` mueve `refs/heads/{PROTECTED_BRANCH}` directo por la API, "
                "que aterriza en la rama igual que un merge."
            )


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    command = strip_heredocs((payload.get("tool_input") or {}).get("command") or "")
    if not MERGE_HINT.search(command):
        sys.exit(0)

    cwd = payload.get("cwd")

    if is_coordinator_workspace(os.environ.get("ORCA_WORKTREE_ID")):
        sys.exit(0)

    try:
        tokens = shlex.split(command)
    except ValueError:
        # Why: comillas sin cerrar. No se puede leer el comando, y un comando ilegible
        # que nombra un merge se rechaza en vez de asumirse inocente.
        deny("No se pudo parsear el comando (comillas sin cerrar) para saber qué mergea.")
        return

    for segment in segments(tokens):
        segment = strip_prefixes(segment)
        if not segment:
            continue
        raw = " ".join(segment)
        if segment[0] == "git":
            push_args = git_push_args(segment)
            if push_args is not None:
                reason = push_targets_protected(push_args, cwd)
                if reason:
                    deny(reason)
        elif segment[0] == "gh":
            check_gh(segment[1:], cwd, raw)


main()
