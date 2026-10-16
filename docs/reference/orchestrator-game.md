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

`ORCA_GAME_LOCALE` is Orca's UI language resolved like the renderer does (`system` reads the OS
locale; a plugin language pack maps by its tag), one of `en`, `es`, `ja`, `ko`, `zh`, else `en`.
The mod translates its words from it; text inside the pixel art stays English for ja, ko and zh
because a Raster only takes width-1 characters.

## Configuration layers

Each field resolves on its own; a later layer wins
([`orchestrator-game-config.ts`](../../src/shared/orchestrator-game-config.ts)):

1. Orca defaults: `mode: on`, `scene: quest`, `hud`, `rewards` and `tracker` all `true`.
2. Global Settings → Agents → **Agent Teams game** (`orchestratorGame`).
3. The project's committed `orca.yaml` — owned by whoever owns the repo, a dev or a company.
4. Settings → the project → **Agent Teams game**, this machine only
   (`orchestratorGameProjects[repoId]`). Each row can say **Inherit**.

Both Settings pages group the game's controls (mode, scene, teammate HUD, rewards, work item
tracking) under an **Agent Teams game** heading that says they apply only to Claude Agent Teams
panes. Under the scene picker a preview paints the effective scene with the mod's own drawing code
([`OrchestratorGameScenePreview.tsx`](../../src/renderer/src/components/settings/OrchestratorGameScenePreview.tsx)
imports `hooks/scene.ts`, `scenery.ts` and `scenes/`), so it cannot drift from what a pane draws:
the spinner scene walking through the six phases with the phase's character under it, or one still
frame when the system asks for reduced motion. `zen` notes what it hides, `off` says the pane starts
as plain Claude, an uninstalled id shows `quest` (what the mod falls back to), and a plugin scene
shows a note instead, because its definition only reaches the mod through `game.state`, never the
renderer. The renderer build strips the mod's TypeScript with its own plugin
([`orca-game-mod-transform.ts`](../../config/build-plugins/orca-game-mod-transform.ts)): the mod's
`tsconfig.json` sets an `h` JSX factory that React's automatic runtime refuses.

```yaml
# orca.yaml
orchestratorGame:
  mode: zen        # on | zen | off
  scene: quest     # quest, vigilante, jrpg, tamer, or a plugin scene: <publisher>.<id>/<scene id>
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

## Built-in scenes

The mod ships four art sets ([`hooks/scenes/`](../../resources/claude-plugins/orca-game/hooks/scenes)),
listed for Settings in `ORCHESTRATOR_GAME_BUILT_IN_SCENES`
([`orchestrator-game-config.ts`](../../src/shared/orchestrator-game-config.ts)). Each dresses the
six phases (working · docs · build · verify · PR · handoff) and signs your messages with a teller.

| Id          | Scene        | World                                        | Party by phase, then teller                                                         | On red CI          | Merge finale    |
| ----------- | ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ | --------------- |
| `quest`     | Quest        | Mountains and hills, sun or night sky        | Squire · Sage · Blacksmith · Knight · Herald · King; Storyteller                    | the member flashes | —               |
| `vigilante` | Night Watch  | Night skyline, rooftops, a signal in the sky | Night Watch · Detective · Gadgeteer · Mentor · Rooftop Run · Commissioner; Narrator | a masked rogue     | `◆ CASE CLOSED` |
| `jrpg`      | Crystal Saga | Crystal spires under day, dusk, storm, night | Mercenary · Mage · Thief · Healer · Lancer · Hero; Chronicler                       | a rival swordsman  | `★ VICTORY ★`   |
| `tamer`     | Beast Tamer  | Flower meadows                               | Tamer · Leafling · Emberpup · Voltbit · Aquafin · Starling; Professor               | a wild glitch bug  | `◓ CAUGHT!`     |

Quest is Jucer Orozco's original quest mode; the other three are his games from
koombea/cineco-orchestrator PR #32. Names are translated to Spanish, Japanese, Korean and Chinese;
the finale is pixel art, so it is English or Spanish. PR #32's per-game HUD words and colors, the
Crystal Saga ATB bar, Beast Tamer evolution, the wild encounter while waiting, and each game's
handed-off tile animation are not ported: they need logic beyond what a scene's data can describe.

## Scenes from plugins

An Orca plugin can add more scenes as JSON (`contributes.gameScenes`); `game.state`
sends the valid ones in an optional `extensions.scenes`, each as `{ id, pluginId, definition }`
with `id` namespaced `<publisher>.<id>/<scene id>`, and lists dropped ones in `warnings`. Settings
→ **Scene** offers the built-in scenes plus those of running plugins, and keeps showing an id from
`orca.yaml` that nothing installed serves; the mod draws `quest` for it. Card and teller names may
be per language (`{ "en": …, "es": … }`); the mod shows the `ORCA_GAME_LOCALE` one. The file
format, limits and consent rules are in [Game scenes](./plugin-development.md#game-scenes).

## Other plugins in a game pane

Other Claude Code plugins keep running in a team pane; while the game is drawn (mode `on` or `zen`
with the band on) the mod draws what they show in the scene's style instead of letting each one
paint its own
([`allies-strip.tsx`](../../resources/claude-plugins/orca-game/hooks/allies-strip.tsx)):

- **Status lines.** A `ui.status` hook takes another plugin's `$.ui.status(text)` before Claude Code
  sees it and keeps it as a row of the **allies strip** under the band, labeled with the plugin's
  name; `undefined` removes the row. With the game `off` the call passes through untouched. The
  user's own `statusLine` is not a plugin call and is never touched.
- **Jev.** The strip reads `$.state` `{ plugin: 'orca-jev-mod-skills', key: 'advisor' }` (Jev's
  `AdvisorState`, `version: 1`) without depending on Jev: its line with model·effort, one row per
  running subagent (title, model, verdict), its CI rows and its latest notice. Any other version or
  shape is ignored, so a newer Jev draws no row rather than a wrong one. The band redraws when that
  value is written; nothing polls it.
- **Zen** keeps one row: Jev's line, or else the latest status.
- **Bands.** A plugin whose `AbovePrompt` hook sits beneath the game keeps its content, drawn under
  the strip, and a `ui.resolve` hook paints every other plugin's `Text` in the scene palette (a
  highlighted run as the gold pill; red, green, yellow and the theme's error, warning and success
  stay). A plugin loaded in the `prepend` tier draws outside the game and can hide it.

The strip keeps at most six rows, the last saying how many it left out, and each row is cut to
the band's width.
