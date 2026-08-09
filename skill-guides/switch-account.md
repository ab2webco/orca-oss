---
name: switch-account
description: >-
  Switch the Claude account of the terminal you are running in, or list the
  managed Claude accounts with their cached quota so the user can pick one. Runs
  `orca account list` with no selector and `orca account switch --to
  <email|id>` with one, letting Orca's runtime swap the account in place and
  resume this same conversation. Use when the user says "switch to account X",
  asks which accounts are available, or when this session is out of quota and
  another account has some left.
---

# Switch Account

Use this skill when the user asks to change the Claude account this terminal runs on, or
asks which accounts are available.

`switch-account` is a skill name, not a CLI namespace. It carries no switching logic of its
own: everything below is one of two `orca account ...` commands. The whole swap — stopping
the agent, changing the account, relaunching, resuming this exact session — belongs to the
Orca runtime that owns the terminal.

## Resolve the CLI

Pick the executable once and substitute it for `orca` in every command below:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value.
- Otherwise, in a dev checkout (the session exposes `ORCA_DEV_REPO_ROOT`, or `orca` is not on PATH but `orca-dev` is), use `orca-dev` — so the commands become `orca-dev account ...`.
- Otherwise, on Linux outside an Orca-managed terminal, use `orca-ide` (never bare `orca` there — it usually resolves to the GNOME Orca screen reader).
- Otherwise, use `orca`.

If the resolved executable cannot run, report its exact error and stop; do not fall through
to another executable, which could target a different Orca build.

## No selector: list the accounts

```bash
orca account list
```

This reads Orca's cached roster and quota — it never forces a provider refresh, so it
cannot stall behind another account's broken auth. Show the user the accounts with their
remaining quota and ask which one to switch to. Add `--json` when you need to parse it.

## Which account is this terminal on

Never answer this from `active`. `active` is the account Orca selects for *new* launches on the
whole machine; a pane can run on a different one, and both readings are internally consistent —
which is exactly how an agent came to tell a user their terminal was still on the old account
while it had already been switched.

The answer is the `terminal` block of the same `orca account list` output. Run it with no
`--terminal` so it resolves the pane you are in, proven from the environment Orca exports there:

```bash
orca account list --json
```

- `terminal.ownership.state: "account"` — this terminal runs on that `accountId` / `email`. That is the answer.
- `"none"` — this terminal owns no managed account; it runs on the login in Orca's shared runtime.
- `"unknown"` — the runtime cannot prove this pane's account. Report exactly that, with the `reason`.

An `unknown` is never a licence to fall back to `active`. Do not substitute
`CLAUDE_CONFIG_DIR`, and do not answer from `/status`: its `Email` field is unreliable for a
managed vault — a fresh pane on one vault reported a different account's email while its own
`/usage` matched the vault it was bound to.

Pass `--terminal <handle>` only to ask about a pane the user named.

If this Orca is too old to print a `terminal` block, the pane's account cannot be determined
from the CLI. Say that, and do not name an account instead.

## With a selector: switch this terminal

```bash
orca account switch --to <email|id>
```

Run it with no `--terminal`: the CLI proves which pane it is running in from the environment
Orca exports there, so it switches the terminal you are in. Never pass a handle you guessed,
and never pass another pane's handle unless the user explicitly named that terminal —
`--terminal <handle>` stops somebody else's agent.

The selector must match exactly one managed Claude account. An email that maps to two
accounts is rejected rather than resolved; use the account id from `orca account list` then.

## What happens after you run it

The command returns as soon as the runtime accepts the switch, before your turn is stopped.
Then, outside this process:

1. Your current turn is interrupted — this is expected, and it is why the command answers you first.
2. The account is swapped for this terminal only. No tab or pane is created, focused, or lost.
3. Claude is relaunched with the same command and flags it was started with, resuming this exact session id.
4. Once the resumed session is verified to be the same one, the runtime sends one message: `Account switched to <account>; continue where you left off.`

So do not print a farewell, do not re-run the command, and do not try to resume the session
yourself. Say what you are switching to, run the command once, and continue your work when
that message arrives.

If the resumed session is not the same one, the runtime rolls back to the original account
and restores the session instead — you will simply still be on the old account.

## When it refuses

A refusal arrives synchronously and nothing has been touched: the terminal, the account
binding and your turn are all intact. Report the message as-is and stop. Common ones:

- **No managed Claude account matches that selector** — run `orca account list` and ask the user which one.
- **That selector matches more than one managed Claude account** — use the account id instead of the email.
- **The selected account is not authenticated in its own Orca vault** — the user has to sign that account in from Orca's Accounts settings.
- **This terminal is already running on that account** — nothing to do; say so.
- **Orca has no recorded launch command for this Claude process** — this Claude was started outside Orca's terminal management, so the runtime will not relaunch it with guessed flags. Tell the user to start the agent from Orca to make it switchable.
- **WSL and SSH-owned terminals are not supported yet** — auth and transcript state do not cross that boundary; do not attempt a manual swap.

If a switch reports `rollback-failed`, do not retry. It carries the account, session id and
terminal needed to recover; relay that line to the user verbatim.

## Do not hand-roll a switch

Never `export CLAUDE_CONFIG_DIR=...`, `/exit`, or `claude --resume <id>` by hand to change
accounts. That path silently starts an empty session when the target account cannot reach
this session's transcript, and it loses `--dangerously-skip-permissions` and any other flag
this agent was started with. The one command above is the supported way.
