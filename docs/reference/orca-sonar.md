# orca-sonar in Orca

orca-sonar (`ab2webco/orca-sonar`, plugin id `ab2web.orca-sonar`) gives agents fast file
and symbol lookup with fewer tokens. Orca reaches it through `orca sonar <command>`.

## Wiring

- **Install once** in Settings → Plugins from `https://github.com/ab2webco/orca-sonar.git#<ref>`.
  The ref is mandatory. Plugins need `pluginSystemEnabled`.
- **Entry point:** `orca sonar <args>` finds the installed tree through
  `<userData>/plugins/ab2web.orca-sonar/current`, a content hash naming the active folder, and
  runs `node <tree>/bin/orca-sonar.ts <args>` with the caller's stdio and exit code.
- **Warm-up:** when a local worktree is created, Orca starts `orca-sonar index --root <worktree>`
  in the background with `ORCA_SONAR_WARMUP=1`. It is never awaited, is killed after 30 seconds,
  and its failures go to the debug log without failing the create. It does nothing unless the
  plugin is installed and Orca grants it its capabilities: a disabled plugin, an update waiting for
  consent, a kill-listed plugin or the plugin system switched off all mean no warm-up, because the
  warm-up runs the plugin's code just as its worker would.
- **Owner switches:** the plugin's Settings page has two switches, kept in its own storage. With
  _agents_ off, `find` and `symbol` exit 1 with "Sonar is turned off for agents"; with _warm-up_
  off, an `index` run marked by `ORCA_SONAR_WARMUP=1` exits 0 without indexing. The plugin CLI
  enforces both, so Orca needs no copy of them.
- **Agent discovery:** the `orca-cli` guide (`orca skills get orca-cli`) has a Sonar section, and
  since 0.2.0 the plugin ships an `orca-sonar` skill. A skill binds consent to the installed tree,
  so every plugin update asks for consent again, and the warm-up waits until it is given.
- **Requirements:** Node 24 or newer on `PATH`. The CLI runs TypeScript without a build step.
- **Index:** `<userData>/plugins-data/ab2web.orca-sonar/index/<repoId>/<rootKey>.sqlite`.
  Nothing is written into a repository, a worktree or `.claude/`.

## Failure modes

| Situation                       | Result                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| Plugin not installed            | `sonar_not_installed` error, exit 1, points to Settings → Plugins  |
| `current` is not a content hash | `invalid_pointer` error, exit 1, reinstall the plugin              |
| Tree has no `bin/orca-sonar.ts` | `missing_entry` error, exit 1, reinstall the plugin                |
| Remote Orca host                | `sonar_remote_unavailable` error, exit 1, named refusal, no output |
| Installed and running           | the CLI's own output and exit code                                 |

## Not in this wiring yet

- **Remote hosts:** the index must be built where the files are, and the CLI must be installed
  there. Refused by name until the owner decides remote distribution.
- **Distribution:** the marketplace listing and the default of `pluginSystemEnabled` are owner
  decisions and are not changed here.
- **Codex panes:** reach the CLI and the guide, not a plugin skill.
- **`orca sonar` and Orca's enable state:** the passthrough runs in the CLI process, which reads
  only the install pointer, so it still runs a plugin disabled in Settings → Plugins. The owner's
  _agents_ switch is what stops agent lookups.

## Checks

- `src/shared/sonar-cli-location.test.ts`, `src/cli/sonar-command.test.ts`: the pointer, the
  not-installed and remote paths, argument and environment forwarding, exit codes.
- `src/main/sonar-index-warmup.test.ts`: no spawn without an install or while the plugin is not
  active, timeout kill, no kill after exit, failures logged and never thrown.
- `src/cli/bundled-orca-cli-guide.test.ts`: the guide served to agents names `orca sonar` and the
  agents-off fallback.
- Live: with the plugin installed under a temporary userData, `orca sonar find runCli --json`
  returned results with exit 0, and `git status --porcelain --ignored` in the worktree was
  unchanged before and after.
