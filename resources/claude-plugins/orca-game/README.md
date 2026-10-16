# orca-game

A game layer for Claude Code sessions that Orca runs as **Claude Agent Teams**. It is a Claude Code
mod (a hooks module drawn inside Claude Code's terminal UI), not an Orca panel plugin.

- **Quest mode.** The spinner becomes a pixel-art scene: Clawd walks a parallax landscape dressed as
  the character of the current flow phase, with a thought bubble saying what it is doing. Each reply
  comes in a card signed by its phase's character, your own messages in a Storyteller card, tool
  rows are hidden unless they fail. `on` (default), `zen` (also hides short working notes) or `off`.
- **The band** above the prompt: a HUD with the lead as the hero and every teammate in the party
  (walking while it works, hopping with `needs you!` while it waits, hurt while CI is red), counts,
  the review with its CI, the work item, a `Needs you:` line, and **Panel**, **Refresh** and
  **Pet Clawd**.
- **The Fleet pane** (Panel): the HUD at full width and one card per agent with its own animated
  tile, then the review and the work item as links. `r` refreshes, `c` pets Clawd, `q` or Esc closes.
  **View** (`1`–`9` by tile order) focuses that teammate's Orca pane.
- **Rewards.** XP and level-ups, kept in the mod's `$.store` across sessions.

## Origin

Ported from the `o` plugin of `koombea/cineco-orchestrator` by **Jucer Orozco** (quest mode, the
pixel art, the band and the Fleet pane). Everything specific to that project (Jira, Tambora, cmux,
the coordination dir, wave/push/sweep actions, autostart) was removed; the fleet now comes only from
Orca's CLI.

## How Orca loads it

Orca ships this folder as `<resourcesPath>/claude-plugins/orca-game` and starts Claude Agent Teams
sessions with `claude --plugin-dir <that folder>`. It needs Claude Code 2.1.287 or later (function
hooks). Other agents never load it.

To try it by hand from a checkout:

```bash
claude --plugin-dir "$(pwd)/resources/claude-plugins/orca-game"
```

## Configuration

Read once when the mod loads:

| Variable            | Values                       | Default | Effect                                                 |
| ------------------- | ---------------------------- | ------- | ------------------------------------------------------ |
| `ORCA_GAME_MODE`    | `on`, `zen`, `off`           | `on`    | Quest mode                                             |
| `ORCA_GAME_SCENE`   | a scene id                   | `quest` | Art set; an unknown id falls back to `quest`           |
| `ORCA_GAME_HUD`     | `1`/`0`, `true`/`false`      | `1`     | `0` hides the band                                     |
| `ORCA_GAME_REWARDS` | `1`/`0`, `true`/`false`      | `1`     | `0` turns off XP, level-ups and the cheer confetti     |
| `ORCA_GAME_LOCALE`  | `en`, `es`, `ja`, `ko`, `zh` | `en`    | Language of the game's words; anything else is English |

The words live in `hooks/game-strings.ts` (English) and `hooks/locales/`. Text drawn inside the
pixel art (the HUD, the thought bubble) must be width-1 characters, so Japanese, Korean and Chinese
keep English there and translate everything else.

The `config` that `orca game state` reports overrides the variables while the session runs, and
`/quest on|zen|off` overrides the mode for the session. `/quest demo` plays a scripted fake party
(every phase, action and reaction, one level-up) without running any command or writing XP;
`/quest on` returns to real data.

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
             terminalHandle?: string /* term_…, kept only in that shape */ }],
  review: { provider: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea',
            number, title, url,
            state: 'open' | 'draft' | 'merged' | 'closed',
            ci: 'pending' | 'success' | 'failure' | 'neutral' | 'none' } | null,
  workItem: { provider: 'plane' | 'jira' | 'linear' | 'github' | 'gitlab',
              identifier, title, url, status,
              statusGroup: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled' | 'unknown' } | null,
  extensions?: { scenes: [{ id: '<pluginKey>/<id>', pluginId, definition: SceneDefinition }] }
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
re-awards: review merged 100, CI turning green 20, work item to review 50, to done 70. A level needs
100 XP times the level. CI red hurts the working party.

## Adding a scene

1. Add `hooks/scenes/<id>.ts` exporting a `SceneDefinition` (`hooks/scenes/scene-definition.ts`):
   a `Look` (sky, mountains, plants), a ten-column `Costume` and a message `Card` for each phase,
   the Storyteller card and the band palette.
2. Add it to `SCENES` in `hooks/scenes/index.ts`.
3. Select it with `ORCA_GAME_SCENE=<id>` or the `scene` setting.

The engine code reads only the definition, so nothing else changes.

An Orca plugin can also ship a scene as JSON (`contributes.gameScenes`, see
`docs/reference/plugin-development.md`). Orca serves it in `extensions.scenes` under the id
`<pluginKey>/<id>`; `hooks/scenes/scene-shape.ts` re-validates it, and `sceneOf` resolves it until
a poll stops serving it. Any id nothing serves draws `quest`.

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
