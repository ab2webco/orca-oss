# Switch Account

This file is a discovery stub, not the usage guide. The full, version-matched account-switch
reference is served by the `orca` binary itself — kept out of this file on purpose so it can
never drift from the binary that will actually run your commands.

Engage this skill when the user asks to change the Claude account this terminal runs on, or
asks which accounts are available. It carries no switching logic: it lists accounts with
their cached quota, or asks Orca's runtime to swap the account of the terminal you are
running in and resume this same conversation.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value. Orca exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside an Orca-managed terminal, use `orca-ide`. Never run bare
  `orca` there — outside Orca's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Orca build.

## Load the full guide before switching anything

```text
ORCA skills get switch-account
```

That prints the complete, version-matched guide for the exact binary that will handle your
next command — how the switch is accepted before your turn is stopped, what the runtime does
after this process exits, and what each refusal means. Read it first, then run the one
command you need.

Don't guess subcommands or flags from memory or from a cached copy of this stub. They
change between Orca releases, and this file deliberately no longer lists them.

## Never answer "which account am I on" from `active`

`active` is the account Orca selects for *new* launches on the whole machine. It does not say
which account this terminal runs on, and reporting it as if it did is how an agent told a user
their pane was still on the old account after it had already been switched. The full guide names
the per-terminal signal to read instead; until you have read it, say the pane's account cannot be
determined rather than naming one.

## Never hand-roll the swap

Whatever the guide says, one rule holds: do not change accounts by exporting
`CLAUDE_CONFIG_DIR`, exiting, and resuming by hand. That path silently starts an empty
session when the target account cannot reach this session's transcript, and it drops the
flags this agent was started with.

## If an older Orca does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
ORCA status --json
ORCA account --help
ORCA account list --json
```

If that `account list` output carries no per-terminal block, this binary cannot tell you which
account the pane runs on. Say so; `active` is not the answer.

Then tell the user that updating Orca restores the full, version-matched guide via
`ORCA skills get switch-account`. Beyond these commands, ask the user rather than guessing a
command surface this older binary may not support.
