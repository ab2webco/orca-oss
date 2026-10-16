# Agent Teams orchestrator game

Claude Agent Teams panes (`orca claude-teams`) load a Claude Code plugin that turns the session
into a small game: a pixel-art scene on the spinner, cards per flow phase, a teammate HUD above
the prompt, and rewards when reviews merge or CI turns green. It started as the quest mode of the
`o` plugin in koombea/cineco-orchestrator (Jucer Orozco) and lives in
[`resources/claude-plugins/orca-game`](../../resources/claude-plugins/orca-game).

Plain Claude, Codex and every other agent are untouched.

## When it loads

Both ways into a team load it with `--plugin-dir <bundled plugin>` and the `ORCA_GAME_*` env
([`orchestrator-game-launch.ts`](../../src/main/claude/orchestrator-game-launch.ts)):

- `orca claude-teams`: `agentTeams.prepareLaunch` returns them and the CLI puts them before the
  user's own args;
- a direct `claude` launch the app turns into a team (Settings → Agent Teams mode): the launch plan
  inserts them after the executable
  ([`claude-agent-teams-shim-env.ts`](../../src/main/runtime/claude-agent-teams-shim-env.ts)), for
  local workspaces only, since the plugin folder is on this machine, and never on Windows.

It loads only when all of these hold, and otherwise Claude starts exactly as before:

- the effective mode is not `off`;
- Claude Code is 2.1.287 or newer (mods). The version is probed with `claude --version`, async and
  cached for ten minutes; an unknown version counts as too old;
- the plugin folder exists in the app resources.

`ORCA_GAME_CLI` carries the absolute Orca CLI the Agent Teams tmux shim already runs. The mod polls
only that path and never a bare `orca`, which on Linux is the GNOME screen reader. Without it the
scene still draws and the band says the state is unavailable.

## Configuration layers

Each field resolves on its own; a later layer wins
([`orchestrator-game-config.ts`](../../src/shared/orchestrator-game-config.ts)):

1. Orca defaults: `mode: on`, `scene: quest`, `hud`, `rewards` and `tracker` all `true`.
2. Global Settings → Agents → **Agent Teams game** (`orchestratorGame`).
3. The project's committed `orca.yaml` — owned by whoever owns the repo, a dev or a company.
4. Settings → the project → **Agent Teams game**, this machine only
   (`orchestratorGameProjects[repoId]`). Each row can say **Inherit**.

```yaml
# orca.yaml
orchestratorGame:
  mode: zen        # on | zen | off
  scene: quest     # quest, or a plugin scene: <publisher>.<id>/<scene id>
  hud: true        # teammate band above the prompt
  rewards: false   # XP, level-ups, celebrations
  tracker: true    # follow the linked work item in the flow
```

An invalid value is dropped and reported (Settings shows the source of every value,
`orca game state` lists the warnings); it never stops the launch.

## What the game reads: `orca game state --json`

The plugin polls this every 30 seconds and after each turn. It resolves the calling pane from
`ORCA_WORKTREE_ID`, `ORCA_TERMINAL_HANDLE` and `ORCA_PANE_KEY`
([builder](../../src/main/runtime/orchestrator-game-state-builder.ts)):

- `config`, `sources`, `warnings` — the resolved layers above;
- `agents` — the worktree's agent rows (`working`, `waiting`, `idle`, `done`, current tool,
  leader flag, and an optional `terminalHandle` when the pane maps to an Orca terminal). The Fleet
  pane's **View** button (hotkeys `1`–`9` by tile order) runs `terminal focus` on that handle;
  a row without one gets no button;
- `review` — the hosted review for the branch from any supported provider (GitHub, GitLab,
  Bitbucket, Azure DevOps, Gitea) with its aggregate CI status;
- `workItem` — the linked item with a live status for Plane, Linear, Jira, GitHub and GitLab, and
  a `statusGroup` (`backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled`, `unknown`)
  so the game never needs to know the tracker. `tracker: false` leaves it out.

A provider that is offline or unauthenticated only drops its own field.

## Scenes from plugins

`quest` is built in. An Orca plugin can add more as JSON (`contributes.gameScenes`); `game.state`
sends the valid ones in an optional `extensions.scenes`, each as `{ id, pluginId, definition }`
with `id` namespaced `<publisher>.<id>/<scene id>`, and lists dropped ones in `warnings`. Settings
→ **Scene** offers quest plus the scenes of running plugins, and keeps showing an id from
`orca.yaml` that nothing installed serves; the mod draws `quest` for it. The file format, limits
and consent rules are in [Game scenes](./plugin-development.md#game-scenes).
