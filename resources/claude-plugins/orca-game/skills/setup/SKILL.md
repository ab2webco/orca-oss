---
name: setup
description: |
  Set up this project's Agent Teams game and lead in its orca.yaml by asking the person what they
  want to integrate (tracker To Do, buttons, MCP activity links, the lead and its rules, scene),
  reading the repo for what it already uses, and writing only what they confirm. Fire when the
  person runs /orca-game:setup, or says "configura el juego", "configura orca.yaml", "integra Jira
  / Tambora / Plane en el juego", "set up the game", "add a button to the game".
user_invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

# /setup — write this project's orca.yaml with the person

Talk in the person's language. Ask **one question at a time** (AskUserQuestion when available,
with the detected option first), and never write a value they did not confirm.
`CLI` below is `"$ORCA_GAME_CLI"`, the absolute path Orca sets in its game panes. If it is empty,
say this session was not started by Orca's game and stop; never run a bare `orca` (on Linux it is
usually the GNOME screen reader).

## 1. Read what is there

- `CLI game state --json`: the effective `config`, which layer set each key (`sources`), the
  `lead`, the `actions`, the `project` To Do and PRs, and `warnings`.
- The repo root's `orca.yaml`, if any. Keep every key and comment it already has.
- What the project already uses, so you can offer it instead of asking blind:
  - `CLAUDE.md` / `AGENTS.md`: flow rules (repo per ticket, review gates, no deploys, who merges).
  - Git remotes and sibling repos the work spans (a frontend and a backend, say).
  - Tracker: ticket keys in branches and commits (`CIN-123` Jira, `ORCA-12` Plane, `ENG-4` Linear),
    `jira` / `plane` / `linear` CLIs, their MCP servers.
  - MCP servers (`.mcp.json`, Claude settings) whose ids could become links (test runs, builds).
  - `bin/` and package scripts the person runs by hand (tests, cleanups, reports).

Say in three to six lines what you found, then ask.

## 2. Ask what to integrate

Offer only what applies, in this order, and skip what they decline:

1. **To Do** (`todo`): which tracker and project, and whether its link should run an action
   instead of opening the tracker's page (`todo.action`).
2. **Buttons** (`actions`, at most 6): what they repeat by hand. For each, a label, a slash
   command, and either a prompt for the lead or an MCP call. A prompt says what to run and what to
   report; work that is not the lead's goes to members (`game launch <id> --prompt "…"`).
3. **Activity links** (`activity`): an MCP tool whose ids should become chips (test runs, builds).
   Ask for one real id and its page URL, and derive `match` and `url` from them.
4. **The lead** (`orchestrator`): name, autostart, members at once (`cap`), agent and model, what a
   member is told (`launchPrompt`), and the project rules from step 1 the lead must follow
   (`rules`). The lead never does ticket work itself.
5. **Look**: scene, HUD, rewards, `render` (`classic` 5-row pixel art or `hd` 9 to 10-row scene)
   and, for hd's day and night, `timezone` (`local` or the team's IANA zone, e.g. `America/Bogota`).

## 3. Write and check

- Show the YAML you will add or change, then write it after the person says yes. Edit in place;
  never drop their keys or comments.
- The exact keys and limits are in [reference.md](reference.md). Run `CLI game state --json` again
  (Orca re-reads orca.yaml on each refresh) and fix every `warnings` entry until there are none.
- Never put a token, password or private URL credential in orca.yaml: it is committed. A scene
  file the person marks as private stays out of git.
- Finish with what changed, the buttons and their slash commands, and that ↻ in the Panel shows it.
