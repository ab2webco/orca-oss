---
name: orca-game-scenes
description: >-
  Create, edit, validate and activate a custom scene for Orca Lab's Agent Teams game
  (the pixel-art band and Fleet pane in a Claude Agent Teams pane) without errors:
  start from `orca game scene new`, edit the JSON, loop on `orca game scene validate`
  until it is clean, select it with `orchestratorGame.sceneFile` in project Settings
  or orca.yaml, and check it live with `/quest demo`. Use when someone asks for a new
  game scene, theme or skin (e.g. "make a Mario scene"), to change a scene's colors,
  characters or names, or when a custom scene draws Quest instead of itself.
---

# Orca Lab game scenes

This file is a discovery stub, not the usage guide. The full, version-matched game scenes
reference is served by the `orca` binary itself — kept out of this file on purpose so it can
never drift from the binary that will actually run your commands.

Engage it whenever someone wants a custom scene for the Agent Teams game (a theme, a skin,
"make a Mario scene"), wants to change a scene's colors, characters or names, or sees a custom
scene drawn as Quest. The guide walks the whole loop — `orca game scene new`, edit,
`orca game scene validate` until clean, activate with `orchestratorGame.sceneFile`, check with
`/quest demo` — and the exact format rules that make a scene draw instead of falling back.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value. Orca Lab exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside an Orca Lab-managed terminal, use `orca-ide`. Never run bare
  `orca` there — outside Orca Lab's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Orca Lab build.

## Load the full guide before running Orca Lab commands

```text
ORCA skills get orca-game-scenes
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — creating, validating and activating a scene, and every rule of its format.
Read it first, then run the specific command you need.

Don't guess subcommands or flags from memory or from a cached copy of this stub. They
change between Orca Lab releases, and this file deliberately no longer lists them. Confirm the
app is up with `ORCA status --json` (start it with `ORCA open --json` if needed), and
prefer `--json` for agent-driven calls.

## If an older Orca Lab does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
ORCA status --json
ORCA game --help
```

Then tell the user that updating Orca Lab restores the full, version-matched guide via
`ORCA skills get orca-game-scenes`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
