# Game data across updates

Owner rule (2026-10-20): an update never loses or breaks a user's game data, and going back one
release keeps the game working. Migration is automatic. A command the user must run is a last
resort, and Orca asks for it in the app; it is never a hidden step.

Every game ticket that adds or changes stored data follows this page and ships a test that reads a
fixture of the previous release's data.

## Where the game keeps data

| Store                                                                             | Owner         | Today's guarantee                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orca.yaml` → `orchestratorGame`                                                  | user          | Orca never writes it. `parseOrchestratorGameLayer` reads key by key and turns an unknown key or bad value into a warning.                                                                                                                                       |
| `.orca/scenes/*.json`, plugin `gameScenes`                                        | user / plugin | Both writers are create-only (`flag: 'wx'`, next free name). The zod scene schema is non-strict, so unknown keys are ignored.                                                                                                                                   |
| `settings.orchestratorGame`, `settings.orchestratorGameProjects`                  | app           | The `with…` updates in `orchestrator-game-settings-updates.ts` spread the layer, so unknown keys survive a save. `orca-data.json` keeps its `.bak` ring.                                                                                                        |
| `userData/orchestrator-game-history/<hash>.json` (history, events, inbox cursors) | app           | Versioned (`schemaVersion`), migrated, backed up and downgrade-safe: see below.                                                                                                                                                                                 |
| `userData/orchestrator-game-leads/<hash>.lead.json`                               | app           | `sessionOf` reads three fields; anything else means "start a new lead".                                                                                                                                                                                         |
| `userData/orchestrator-game-leads/live-leads.json`                                | app           | `version: 1`. Missing, damaged or other-version file reads as no leads; another version's file is never written; bad records are skipped. Atomic temp-and-rename write.                                                                                         |
| `userData/orchestrator-game-stop/<hash>.stop.json`                                | app           | Unreadable fails closed (counts as STOP set). Never rename or retype `since` / `by`.                                                                                                                                                                            |
| `userData/orchestrator-game-members/<hash>.members.json`                          | app           | Versioned (`version`). Unknown keys survive a rewrite. A newer or damaged file is reported and never written; a discard sets only a damaged one aside.                                                                                                          |
| `orchestration.db` `worker_dispatches.advisor_report`, `observed_model`           | app           | The SQLite `user_version` ladder. `advisor_report` carries `version: 1`; add optional fields without bumping it (ORCA-657), since older builds drop a report with any other number.                                                                             |
| `orchestration.db` `remote_dispatch_attachments.game_scene`                       | app           | Migration 37. JSON `{ id, text }`: a remote member's scene, the lead's file as written; the host re-validates the text on every read and draws its own file first. Older builds ignore the column.                                                              |
| Plugin `$.store` (`xp-ledger`, lead names)                                        | Claude Code   | `<CLAUDE_CONFIG_DIR>/plugins/store/orca-game_inline-<id>.json`. The id does not follow the plugin's content-hashed folder, so an update that replaces the folder keeps the XP.                                                                                  |
| Plugin `$.store` `panel-layout`                                                   | Claude Code   | `version: 2`. A version 1 value is upgraded on read, keeping every section it drew; the next write stores version 2. Unknown keys and other projects survive a write. A damaged value draws the default; a newer one is drawn as the default and never written. |

`<hash>` is `sha256(projectKey)` cut to 32 hex characters, with `projectKey` = `repo:<repoId>`. Two
projects never share a file, so each one migrates on its own. The userData stores live on the Orca
host, not over SSH; a folder workspace or SSH worktree reads its `orca.yaml` and scene files through
the same filesystem provider it always did.

## Rules for a change

1. **Adding an optional field needs no version.** Every reader ignores keys it does not know, and
   the history store writes back what it read. This is the default answer.
2. **Renaming, retyping or removing a stored field needs a migration step.** Add it to the store's
   ordered list (`GAME_HISTORY_MIGRATIONS`); step `i` turns version `i + 1` into `i + 2`. A step is a
   pure function of the whole file's object, so it can be run twice on the same input and give the
   same answer. Its test reads the previous release's fixture
   (`src/main/runtime/__fixtures__/orchestrator-game-history-lab-104.json` for the history store) and
   checks what the game shows afterwards.
3. **A new enum value (an outcome, an event kind) is not a migration.** An older build skips the
   entry it cannot read and keeps it in the file.
4. **Never rewrite a user's file to add a key.** Read the old and the new shape. If a rewrite is ever
   needed, it is an in-app "update config" action that shows the diff first; none exists yet because
   no change has needed one.
5. **Anything a paired client and host exchange** follows
   [`remote-wire-compatibility.md`](./remote-wire-compatibility.md) as well.

## How the history store migrates

[`orchestrator-game-history-store.ts`](../../src/main/runtime/orchestrator-game-history-store.ts) with
the runner in
[`orchestrator-game-store-migration.ts`](../../src/shared/orchestrator-game-store-migration.ts):

- A file with no `schemaVersion` is version 1 (lab.104 and earlier).
- Reads migrate in memory only. The migrated shape is written by the next write, inside the
  per-project queue, after copying the file to `<hash>.v<from>-<timestamp>.backup.json`. Backups
  are kept; the store never reads them.
- A kill mid-migration leaves either the old file or the new one: the write is a durable
  temp-and-rename, and the backup is written before it. The next start migrates again.
- A file written by a newer build, or one whose migration step throws, is **frozen**: read as well
  as this build can, written back in the same shape and version, with new entries appended. If
  `records` or `events` is no longer a list (or `cursors` no longer an object), this build does not
  write the file at all: the new entry is lost rather than everything the newer build stored.
- On every rewrite, top-level keys, record fields and whole entries this build cannot read are kept
  as they were.
- A file that is not JSON is moved to `<hash>.damaged-<timestamp>.json` before the store starts a
  new one.

**What this cannot fix.** Builds up to lab.104 rebuild every entry on rewrite. Going back from a
build that wrote new fields to one of those drops the new fields on its first write. The
protection starts with the first build that ships this store.
