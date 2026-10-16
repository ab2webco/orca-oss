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
  sceneFile: .orca/scenes/mario.json  # optional: the project's own scene; wins over scene (below)
  hud: true        # teammate band above the prompt
  rewards: false   # XP, level-ups, celebrations
  tracker: true    # follow the linked work item in the flow
```

An invalid value is dropped and reported (Settings shows the source of every value,
`orca game state` lists the warnings); it never stops the launch.

For an SSH worktree the project layer is read from the host over the SSH filesystem
([`worktree-orca-yaml.ts`](../../src/main/worktree-orca-yaml.ts)); while the host is disconnected
the other layers still apply.

`links` and `activity` (below) are lists, so a later layer that sets one replaces the whole list
instead of merging it. Settings has no editor for them; `orca.yaml` is where they are written, and
a value in a Settings layer is validated the same way.

## Project links and activity

Every project shows its own integrations in the scene. Orca's own (the review, its CI and the
work item) are built in; anything else, such as a test manager reached through an MCP server, is
declared in `orca.yaml` ([`orchestrator-game-integrations.ts`](../../src/shared/orchestrator-game-integrations.ts)):

```yaml
# orca.yaml
orchestratorGame:
  links: # static, at most 6
    - label: Test plan # at most 24 characters
      url: https://<your-tambora-host>/projects/CIN
    - label: Ticket
      url: https://jira.example.com/browse/{workItem.identifier}
  activity: # at most 8 rules
    - name: Tambora run # at most 24 characters
      tools: mcp__tambora__* # tool name glob; every MCP tool when omitted
      match: 'TR-([A-Z]+)-\d+' # regular expression, at most 200 characters
      url: https://<your-tambora-host>/projects/{1}/testruns/{0}
    - name: Tambora case
      tools: mcp__tambora__*
      match: 'TC-([A-Z]+)-\d+'
      url: https://<your-tambora-host>/{1}/testcase/{0}
```

- **Link URLs** may use `{workItem.identifier}`, `{workItem.provider}`, `{branch}` and
  `{review.number}`. Values are URL-encoded, and a link whose placeholder has no value in this
  worktree is left out.
- **Activity URLs** use `{0}` for the whole match and `{1}`–`{9}` for its groups; a group the
  pattern does not have is rejected.
- **Validation.** A URL must be `http` or `https` with a literal host: no placeholder, brace or
  `user@` before the path, so a value can never change where a link points. A pattern must compile
  and must not match empty text. Each invalid entry is dropped with a warning in
  `orca game state`, like any other `orchestratorGame` field.
- **Matching.** For every `mcp__*` tool call an agent makes, the hook server keeps the call in
  memory: the input as JSON (at most 2 KB) and the result text (at most 4 KB), the last eight calls
  per pane ([`orchestrator-game-mcp-calls.ts`](../../src/main/agent-hooks/orchestrator-game-mcp-calls.ts)).
  `orca game state` runs the rules over the input followed by the result, cut to the first 4 KB,
  newest call first; the first rule that matches wins. Only the matched id and the URL it built
  leave memory. A call is `running` from its `PreToolUse` until its `PostToolUse`, a failure or the
  turn's `Stop`.
- **Memory.** The newest match per pane is remembered once its call leaves those eight
  ([`orchestrator-game-activity-memory.ts`](../../src/main/runtime/orchestrator-game-activity-memory.ts)),
  so the link stays until a newer call matches; a remembered one is never `running`. At most 64
  panes are kept, the least recently matched dropped first.
- **SSH agents.** The relay forwards no raw tool input, so a remote call is matched on its result
  text alone.
- **Built-in rules** follow the project's rules and exist only for a host this worktree already
  revealed: a key of the work item's project (`ORCA-12` next to `ORCA-586`) in a Plane, Jira or
  Linear MCP call links through the work item's own URL, and a `pullNumber`/`issue_number`
  (GitHub) or `merge_request_iid`/`issue_iid` (GitLab) in that provider's MCP input links into the
  review's repository. Without a work item or review there is no host, and no rule.

Nothing project-specific lives in Orca: the Koombea cineco example (its Tambora host and keys)
is in that project's own `orca.yaml`.

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
  so the game never needs to know the tracker. `tracker: false` leaves it out;
- `links` (optional) — what the scene can make clickable, each
  `{ id, kind, provider, label, url, status?, tone? }`: `review`, `ci` (the GitHub checks or GitLab
  pipelines page of the review, when it has checks), `workItem`, the project's `project` links and
  one `activity` link per distinct URL the agents' activity points at. `tone` is `neutral`,
  `pending`, `success` or `danger`; every `url` is `http(s)`;
- `activity` (optional, on an agent row and at the top for the calling pane) —
  `{ name, id, url, at, running }`, the newest MCP call a rule matched (see
  [Project links and activity](#project-links-and-activity)).

A provider that is offline or unauthenticated only drops its own field. `links` and `activity`
are new optional fields: a mod built before them reads the state exactly as before, and this mod
keeps only whole entries with an `http(s)` URL (at most 32 links).

## Links in the band and the Fleet pane

Every link is a terminal hyperlink (OSC 8); Orca opens it on Cmd/Ctrl-click or from its link
popover.

- **Band chips**, after the team counts: the review (`#901 open`), its CI as a chip of its own
  (`CI failing`, red, yellow or green), the work item (`CIN-123 In Progress`), each distinct
  agent activity (`▶ Tambora TR-CIN-12` while its call runs, `Tambora TR-CIN-12` after) and the
  project's links (`↗ Test plan`). When the band is narrow the project links shorten and drop
  first, then activity, then CI; the review and work item are kept longest. A host that sends no
  links draws the review with its CI words (`#901 open · CI failing`) as before.
- **Needs you.** A failing CI need links to the checks page (the review when there is no CI
  link); the line is cut to the band's width.
- **Fleet pane.** Each teammate card shows its activity as a link under its status, cut to the
  card. An **Open** row takes hotkeys: `i` the work item, `o` the review, `c` CI, `w` the first
  project link and `a` the calling pane's activity (else the first one linked). Each runs
  `orca tab create --url <url> --worktree id:<worktree> --json`, so it opens in an Orca browser
  tab of the worktree on every platform, and a toast says when Orca could not. The menu keeps `r`
  (Refresh) and `q` (Close); Pet Clawd is `p`.

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

## A project's own scene file

A project can draw its own scene without writing a plugin: `orchestratorGame.sceneFile` is a scene
JSON path **relative to the worktree root**
([`orchestrator-game-scene-file.ts`](../../src/shared/orchestrator-game-scene-file.ts)).

```yaml
# orca.yaml
orchestratorGame:
  sceneFile: .orca/scenes/mario.json
```

- **Where it is read from.** Only the project layers: `orca.yaml` and Settings → the project →
  **Agent Teams game**. Global Settings never offers it, and a hand-written global value is ignored
  with a warning, since a path only means something inside one project.
- **Precedence.** A `sceneFile` wins over a `scene` at the same or a lower layer; a `scene` at a
  higher layer wins over it (a project Settings scene beats an `orca.yaml` file). Picking a scene in
  the project picker clears that layer's `sceneFile` and back, so the picker is the one source of
  truth for the layer.
- **Validation.** An absolute path, a Windows drive or UNC path, or a path with a `..` part is
  dropped with a warning, in the shared resolver for every layer. Backslashes become `/`, and `.`
  and empty parts are dropped, so `./.orca//scenes/a.json` is stored as `.orca/scenes/a.json`.
- **Reading.** `game.state` reads the file on every build, so an edit shows on the mod's next poll
  with no restart ([`worktree-game-scene-file.ts`](../../src/main/worktree-game-scene-file.ts)). An
  SSH worktree's file is read from its host through the SSH filesystem provider, like its
  `orca.yaml`; each worktree reads its own copy. A link that resolves outside the worktree, a file
  over 64 KB, or a disconnected SSH host counts as unreadable.
- **What the game gets.** A valid file is validated by the same parser as a plugin scene and sent in
  `extensions.scenes` as `{ id: "file:<path>", pluginId: "file", definition }`, and `config.scene`
  is that `file:<path>` id, so the mod draws it like a contributed scene. A missing or invalid file
  sets `config.scene` to `quest` and puts `Scene file <path>: <reason>; drawing Quest` first in
  `warnings`, which the mod shows as its note. A mod older than this drops the `file:` scene and
  draws `quest`.
- **Format.** The same JSON as a plugin scene ([Game scenes](./plugin-development.md#game-scenes)):
  every phase in `looks`, `costumes` and `cards`, plus `teller` and `band`. Colors are `#rrggbb`
  strings or integers; the mod's own validator
  ([`scene-shape.ts`](../../resources/claude-plugins/orca-game/hooks/scenes/scene-shape.ts)) takes
  both, as Orca's does.
- **Team band colors.** The optional `hud` object paints the team band's pixel-art frame and sky:
  `skyTop`, `skyBottom`, `frame`, `text`, `dim` (the second line of each teammate) and `star`, all
  six required when `hud` is present. Without it the band keeps Quest's night sky, so only the
  characters and the chips (`band`) take the scene's colors.

**Settings.** The project's **Scene** picker ends with **Custom file…**, which shows the path (typed,
relative to the project root; a path leaving the project is refused inline) and three actions:

- **Choose file…** opens a native dialog for `.json` files starting in the project, and refuses a
  file outside it. It is hidden for SSH projects, where the dialog could only browse this computer.
- **Create from <scene>** writes the current built-in scene (Quest when the effective scene is not
  built in) as pretty JSON with `#rrggbb` colors to `.orca/scenes/<scene id>.json`, or `-2`, `-3`…
  when that exists — it never overwrites a file — through the project's filesystem (SSH included),
  then selects it.
- **Open in editor** opens the file in Orca's editor, in the project's active worktree or else its
  main one.

The preview under the picker paints the file with the mod's drawing code and reads it again when the
window regains focus; an unreadable or invalid file shows the parser's reason and the preview draws
Quest, as the pane would. A `sceneFile` inherited from `orca.yaml` shows the same reason under the
row.

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
the band's width (the label to a third of it, the text next, the badge dropped first).

## Narrow panes

The band lays itself out for the pane's width
([`chip-rows.ts`](../../resources/claude-plugins/orca-game/hooks/chip-rows.ts)): the status chips
fill at most two rows and the menu one, whole chips only. When they do not fit, the least important
labels shorten first (`2 working` to `• 2`, the review to `#42 ✗`, Refresh and Pet Clawd to their
icon), then chips drop and a `+N` counts them. Below 37 columns the HUD frame has no room for a
teammate, so it becomes one line of text (`Lv 2 · • builder  ! scribe`); above that, teammates the
frame cannot seat are counted as `+N` on its top edge. Widths are measured in terminal cells, so
Japanese, Korean and Chinese labels count two per character.
