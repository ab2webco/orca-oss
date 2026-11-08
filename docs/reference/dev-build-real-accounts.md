# A dev build on the real accounts

A live check sometimes needs a dev Orca (`npm run dev`) signed in to the real Claude accounts.
The dev build then runs on the same machine as the installed Orca and shares some of its files.
This page covers what the dev build may touch and what it leaves alone.

## The recipe

- `ORCA_DEV_USER_DATA_PATH=<scratch>` gives the dev build its own profile, and
  `ORCA_USER_DATA_PATH=<scratch>` points the `orca` CLI at it.
- Seed `<scratch>/profiles/local-default/orca-data.json` with the settings of the live profile.
  Keep `repos` and `tabs` empty, or dev restores the real workspace and starts agents.
- Symlink `<scratch>/claude-accounts` and `<scratch>/claude-transcripts` to the real ones.
  Copying a vault instead forks its refresh-token chain.
- When you are done, remove both links before you delete the profile, and quit the dev build.

## What a dev build never rewrites

These files belong to the installed Orca. An unpackaged, non-E2E build follows that rule
(ORCA-1113, ORCA-1131):

| File | Dev behavior |
| --- | --- |
| `~/.claude/settings.json` | Adds an Orca entry only when none exists. Never replaces one. |
| `~/.orca/agent-hooks/*` | Creates a missing script. Never rewrites an existing one. |
| `~/.codex/hooks.json` | Never written. Dev Codex panes use the managed home under the profile. |
| Plugin workers' `HOME` | Points at `<scratch>/plugin-home`, not the real home. |

## Plugins on a linked vault

Orca cannot sandbox a plugin that can start processes (`process:spawn`). Its child processes
write wherever they like. Some of them write hook paths into every vault under
`$ORCA_USER_DATA_PATH/claude-accounts`. Through the symlink, that is the real vault. The paths
point into the dev profile, so real sessions would run dev hooks, and later dead hooks once the
profile is deleted.

So when `<userData>/claude-accounts` resolves outside the dev profile, the dev build does not
start those plugins. Settings → Plugins → Installed marks each one Blocked and says why. Plugins
that cannot spawn processes still run.

To run them anyway, start the dev build with `ORCA_DEV_SHARED_VAULT_PLUGINS=1`. Before you
do, back up every account's `settings.json`. Afterwards, restore the backups and prove with a
diff that they are byte-identical. Packaged builds are never gated.
