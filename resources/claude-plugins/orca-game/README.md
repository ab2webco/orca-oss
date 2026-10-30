# orca-game

A game layer for Claude Code sessions that Orca runs as **Claude Agent Teams**. It is a Claude Code
mod (a hooks module drawn inside Claude Code's terminal UI), not an Orca panel plugin.

- **Quest mode.** The spinner becomes a pixel-art scene: Clawd walks a parallax landscape dressed as
  the character of the current flow phase, with a thought bubble saying what it is doing. Each reply
  comes in a card signed by its phase's character, your own messages in a Storyteller card, tool
  rows are hidden unless they fail. `on` (default), `zen` (also hides short working notes) or `off`.
- **Flat mode.** `flat` draws the same game as text in the scene's colors, with no scene or
  characters: one line per teammate (name, ticket, phase, PR, CI), a score line (level, XP, latest
  rewards) and the phase's card above the spinner. The band's `≡ Text` / `▦ Scene` chip and the
  Panel's `0` key flip it for the session, back to the mode shown before.
- **The band** above the prompt: a HUD with the lead as the hero and every teammate in the party
  (walking while it works, hopping with `needs you!` while it waits, hurt while CI is red), counts,
  the review, its CI, the work item, agent activity and project links as clickable chips, a
  `Needs you:` line, and **Panel**, **Refresh** and **Pet** (`♥ Pet <name>` when the scene has a
  pet of its own, which it hearts; Clawd otherwise).
- **The Fleet pane** (Panel): the HUD at full width and one card per agent with its own animated
  tile and activity link, then the review and the work item as links. **Open** takes `i` (work
  item), `o` (review), `c` (CI), `w` (first project link) and `a` (activity) into an Orca browser
  tab. `r` refreshes, `p` pets, `q` or Esc closes. **View** (`1`–`9` by tile order) focuses
  that teammate's Orca pane. Each section (Team, Review, My PRs, To Do, Actions) collapses from
  the `▾` before its heading, and `/orca-game:layout` hides, moves or resets them; the layout is
  kept per project in `$.store`.
- **Rewards.** XP and level-ups, kept in the mod's `$.store` across sessions.
- **Allies.** Other plugins keep running: their `$.ui.status` lines, and Jev's advisor state when
  Jev is installed, become rows of a strip under the band, and their band elements take the scene
  palette. See `docs/reference/orchestrator-game.md` (Other plugins in a game pane).
- **The cast.** A scene's `cast` adds a pet beside the hero and the character that stands for Jev:
  while Jev publishes, it acts out each new decision and CI state at the scene's edge (a referee
  unless the scene dresses it), and the Panel lists its latest decisions. See
  `docs/reference/orchestrator-game.md` (The cast).
- **hd.** `render: hd` draws the spinner scene as a 9 to 10-row 2D-HD scene: a lit sky with clouds,
  fogged layers, outlined and shaded characters, day and night on the project's `timezone`,
  particles, the party following the hero, the crowned lead, floating team reactions and a thought
  cloud (`hooks/scene-hd.ts` and the `hooks/hd-*.ts` files). See
  `docs/reference/orchestrator-game.md` (Render: classic or hd).

## Origin

Ported from the `o` plugin of `koombea/cineco-orchestrator` by **Jucer Orozco** (quest mode, the
pixel art, the band and the Fleet pane). Everything specific to that project (Jira, Tambora, cmux,
the coordination dir, wave/push/sweep actions, autostart) was removed; the fleet now comes only from
Orca's CLI.

The **Night Watch** (`vigilante`), **Crystal Saga** (`jrpg`) and **Beast Tamer** (`tamer`) scenes
are also his, from PR #32 of that repo: worlds, costumes, foes, cards and finales, with the
far-layer drawing (skyline, crystal spires, meadow, the signal) in `hooks/scenery.ts`.

## How Orca loads it

Orca ships this folder as `<resourcesPath>/claude-plugins/orca-game` and starts Claude Agent Teams
sessions with `claude --plugin-dir <that folder>`. It needs Claude Code 2.1.287 or later (function
hooks). Other agents never load it.

To try it by hand from a checkout:

```bash
claude --plugin-dir "$(pwd)/resources/claude-plugins/orca-game"
```

## Configuration

The env is the launch snapshot. Orca's live answer from `orca game state` (every 30 s and after
each turn) can change mode, scene, HUD, rewards, render and timezone since, and `/orca-game:mode`
overrides the mode for the session:

| Variable             | Values                     | Default   | Effect                                                 |
| -------------------- | -------------------------- | --------- | ------------------------------------------------------ |
| `ORCA_GAME_MODE`     | `on`, `zen`, `flat`, `off` | `on`      | Quest mode                                             |
| `ORCA_GAME_SCENE`    | a scene id                 | `quest`   | Art set; an unknown id falls back to `quest`           |
| `ORCA_GAME_HUD`      | `1`/`0`, `true`/`false`    | `1`       | `0` hides the band                                     |
| `ORCA_GAME_REWARDS`  | `1`/`0`, `true`/`false`    | `1`       | `0` turns off XP, level-ups and the cheer confetti     |
| `ORCA_GAME_RENDER`   | `classic`, `hd`            | `classic` | The 5-row pixel art, or the 9 to 10-row 2D-HD scene    |
| `ORCA_GAME_TIMEZONE` | `local` or an IANA zone    | `local`   | The clock hd's day and night follow                    |
| `ORCA_GAME_LOCALE`   | `en`, `es`                 | `en`      | Language of the game's words; anything else is English |

A project's own scene file comes from `sceneFile` in its `orca.yaml`, which Orca reads and serves
through `orca game state`; the env never carries a path.

Other plugins can follow the game through its state `{ plugin: 'orca-game', key: 'absorbing' }`, a
`boolean` that is true exactly while the game draws other plugins' lines (mode not `off` and the HUD
on). It is written at load and on every change from the env, Orca's live config or
`/orca-game:mode`.

The words live in `hooks/game-strings.ts` (English) and `hooks/locales/`. Text drawn inside the
pixel art (the HUD, the thought bubble) must be width-1 characters, so a wide character there (a
CJK teammate or file name an agent reports) is drawn as `?`; the text around the art shows it.

The `config` that `orca game state` reports overrides the variables while the session runs.

## Commands: `/orca-game:`

Typing `/orca-game:` lists every game command. Each is a plugin skill the mod answers itself
(`hooks/game-commands.ts`), so no model turn runs and no shell is involved; the engine refuses a
`:` in a name a mod registers, which is why they are skills.

| Command                               | What it does                                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/orca-game:state`                    | The game state from a fresh `orca game state`: each setting with its layer, this session's mode and render, the lead and its members with their slots, a held STOP, warnings and links |
| `/orca-game:layout [verb]`            | The Panel's sections with their state; `reset`, `show <section>`, `hide <section>`, `move <section> up\|down`                                                                          |
| `/orca-game:mode on\|zen\|flat\|off`  | The mode for this session; alone, prints the mode and render                                                                                                                           |
| `/orca-game:render classic\|hd`       | The render for this session; alone, prints the mode and render                                                                                                                         |
| `/orca-game:demo`                     | A scripted fake party (every phase, action and reaction, one level-up) that runs no command and writes no XP; `/orca-game:mode on` returns to real data                                |
| `/orca-game:quest [args]`             | The long form taking all of the above (`render hd`, `zen`, `demo`)                                                                                                                     |
| `/orca-game:setup`, `/orca-game:lead` | Write the project's `orca.yaml` with you; make the session the project's lead                                                                                                          |

`/quest [args]` is the short form of `/orca-game:quest`, registered by the mod as `immediate` so
it runs at once even while a turn streams. A mode or render set this way is this
pane's alone: `orca game state` reports only Orca's layers, so `/orca-game:mode` and
`/orca-game:render` print the configured value and its layer beside an override, as in
`Render: hd (this session; the project's setting is classic, from default).` Project buttons
(`actions[].command` in `orca.yaml`) keep the names the project chose and are not under
`/orca-game:`.

## Fleet data: `orca game state --json`

Polled every 30 s and after each of the lead's turns. The answer is either the bare object or
`{ "result": { ... } }`. A missing or failing CLI means no fleet data: the band says so, the
scene keeps working, and nothing throws. `hooks/game-state.ts` validates the shape and drops bad
entries.

```ts
{
  config: { mode, scene, hud, rewards, tracker },
  sources: { ... },
  warnings: string[],
  worktree: { id, path, branch, displayName },
  agents: [{ paneKey, displayName, agentType,
             state: 'working' | 'waiting' | 'idle' | 'done',
             toolName: string | null, isLeader: boolean,
             terminalHandle?: string /* term_…, kept only in that shape */,
             /* members only, as `game fleet` reads them: */
             ticket?, host /* paired host or 'local' */, accountEmail?, worktreeId?, branch?,
             pr?: number, ci? }],
  review: { provider: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea',
            number, title, url,
            state: 'open' | 'draft' | 'merged' | 'closed',
            ci: 'pending' | 'success' | 'failure' | 'neutral' | 'none' } | null,
  workItem: { provider: 'plane' | 'jira' | 'linear' | 'github' | 'gitlab',
              identifier, title, url, status,
              statusGroup: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled' | 'unknown' } | null,
  extensions?: { scenes: [{ id: '<pluginKey>/<id>' | 'file:<path>', pluginId, definition: SceneDefinition }] }
}
```

## Phases and rewards

A session's own tool calls set its phase: an edit under `docs/` or to a Markdown file is the
**Sage**, any other edit the **Blacksmith**, tests and linters the **Knight**, `git push`,
`gh pr create` or `glab mr create` the **Herald**, and a merge (`gh pr merge`, `glab mr merge`) or a
tracker status change (`orca plane status set`, `orca linear status set`, a tracker MCP update) the
**King**. Teammates get theirs from their current tool, then from the worktree (an open review is
the Herald, a merged one or a work item in review or done is the King).

XP is earned only for a change seen between two polls of the same worktree, so a restart never
re-awards: review merged 100, CI turning green 20, work item to review 50, to done 70. A lead
(`role` not `member`) also earns the same for each member in its own worktree, plus 10 when a
member appears; those use the ids the member's pane would, so a shared store never counts one change
twice ([`hooks/fleet-rewards.ts`](hooks/fleet-rewards.ts)). Those are the defaults: `game state`
hands over the project's `rewardWeights` (0 turns a reward off and writes no row), and a host
older than that gets the defaults; the scoring table is in
`docs/reference/orchestrator-game.md`. A level needs 100 XP times the level, and a row that takes
XP away can lower the total but never the level below 1. CI red hurts the working party.

## Adding a scene

1. Add `hooks/scenes/<id>.ts` exporting a `SceneDefinition` (`hooks/scenes/scene-definition.ts`):
   a `Look` (sky, far layer, plants), a ten-column `Costume` and a message `Card` for each phase,
   the Storyteller card and the band palette; optionally a `foe` for red CI and a merge `finale`.
2. Add it to `SCENES` in `hooks/scenes/index.ts`, and its id to Orca's
   `ORCHESTRATOR_GAME_BUILT_IN_SCENES` (with a Settings label) so the picker offers it.
3. Select it with `ORCA_GAME_SCENE=<id>` or the `scene` setting.

The engine code reads only the definition, so nothing else changes.

An Orca plugin can also ship a scene as JSON (`contributes.gameScenes`, see
`docs/reference/plugin-development.md`). Orca serves it in `extensions.scenes` under the id
`<pluginKey>/<id>`; `hooks/scenes/scene-shape.ts` re-validates it, and `sceneOf` resolves it until
a poll stops serving it. Any id nothing serves draws `quest`.

A project's own scene file (`orchestratorGame.sceneFile`, see `docs/reference/orchestrator-game.md`)
arrives the same way under `file:<path in the worktree>` with `pluginId: 'file'`. Colors may be
integers or `#rrggbb` strings, as Orca's parser takes them.

## Development

- Pure logic tests (vitest, part of Orca's `npm test`):
  `npx vitest run --config config/vitest.config.ts resources/claude-plugins/orca-game`.
  They are `*.spec.ts` because `claude plugin test` claims every `*.test.ts` in a mod folder.
- Engine tests (`tests/engine.test.ts`, against Claude Code itself):
  `claude plugin test resources/claude-plugins/orca-game`.
- `claude plugin validate resources/claude-plugins/orca-game` checks the manifest and the module the
  way the engine loads it.
- Types: there is no command to generate them. Claude Code writes `.claude-plugin/types/` (the
  `claude-code` module, its built-in tools and connected MCP tools) every time it loads the mod from
  a `--plugin-dir` folder in an interactive session; the folder is gitignored and never packaged.
  After one such load, `npx tsc -p resources/claude-plugins/orca-game` type-checks the mod. Without
  it, point a `tsconfig.json` kept outside the folder at the declaration file the plugin-authoring
  skill writes and include `hooks`, `types` and `tests`.
