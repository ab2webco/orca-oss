# Agent Teams orchestrator game

Claude Agent Teams panes (`orca claude-teams`) load a Claude Code plugin that turns the session
into a small game: a pixel-art scene on the spinner, cards per flow phase, a teammate HUD above
the prompt, and rewards when reviews merge, CI turns green or tickets move on (a project lead's
own and its members'). It started as the quest mode of the
`o` plugin in koombea/cineco-orchestrator (Jucer Orozco) and lives in
[`resources/claude-plugins/orca-game`](../../resources/claude-plugins/orca-game).

Plain Claude, Codex and every other agent are untouched.

## When it loads

Both ways into a team load it with `--plugin-dir <bundled plugin>` and the `ORCA_GAME_*` env
([`orchestrator-game-launch.ts`](../../src/main/claude/orchestrator-game-launch.ts)):

- `orca claude-teams`: `agentTeams.prepareLaunch` returns them and the CLI puts them before the
  user's own args (not on Windows, where that command refuses to run);
- a direct `claude` launch the app turns into a team (Settings → Agent Teams mode): the launch plan
  inserts them after the executable
  ([`claude-agent-teams-shim-env.ts`](../../src/main/runtime/claude-agent-teams-shim-env.ts)), for
  local workspaces only, since the plugin folder is on this machine. On Windows the args are quoted
  for the pane's shell (see [On Windows](#on-windows)); a WSL pane gets no game.

It loads only when all of these hold, and otherwise Claude starts exactly as before:

- the effective mode is not `off`;
- Claude Code is 2.1.287 or newer (mods). The version is probed with `claude --version`, async and
  cached for ten minutes; an unknown version counts as too old;
- the plugin folder exists in the app resources.

`ORCA_GAME_CLI` carries the absolute Orca CLI the Agent Teams tmux shim already runs. The mod polls
only that path and never a bare `orca`, which on Linux is the GNOME screen reader. Without it the
scene still draws and the band says the state is unavailable.

`ORCA_GAME_LOCALE` is Orca's UI language resolved like the renderer does (`system` reads the OS
locale; a plugin language pack maps by its tag), one of `en`, `es`, else `en`. The mod translates
its words from it. A Raster only takes width-1 characters, so a wide character inside the pixel art
(a CJK teammate or file name an agent reports) is drawn as `?`.

### On Windows

The pane's shell parses the launch line, so `--plugin-dir` is quoted for it
([`orchestrator-game-pane-shell.ts`](../../src/main/claude/orchestrator-game-pane-shell.ts) picks
the shell the pty spawn will open, from the same settings and project runtime):

| Pane shell                                                  | Quoting of the plugin dir                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PowerShell 5.1 and 7 (the default)                          | a `'…'` literal, `'` doubled                                                                                           |
| cmd.exe                                                     | `"…"`, stepping out of the quotes for each `%` as `"^%"`; `& ^ ( ) !` stay inside them                                 |
| Git Bash / MSYS                                             | a POSIX `'…'` word, backslashes kept                                                                                   |
| WSL (`wsl.exe`, a `\\wsl$` worktree, a WSL project runtime) | no game: the distro's Linux Claude cannot load a Windows plugin path, and `ORCA_GAME_*` is not crossed into the distro |

A cmd pane with delayed expansion turned on in the registry would still read `!…!` in the path;
Orca does not open cmd with `/V:ON`.

`ORCA_GAME_CLI` is handed over with forward slashes (`C:/Program Files/…/orca.exe`): Claude Code
runs its Bash tool through Git Bash on Windows, which runs a word with a `/` as a path, so the
skills' `"$ORCA_GAME_CLI" game lead` works there; `orca game lead` prints its commands as one
POSIX-quoted word with forward slashes for the same reason. A packaged Orca hands over
`resources/bin/orca.exe`; a dev build's `orca-dev.cmd` cannot be started without a shell, so the
mod runs a `.cmd`/`.bat` CLI as `%ComSpec% /d /v:off /s /c %ORCA_GAME_CLI_LINE%`, the quoted
command line travelling in that env var, which cmd expands once after parsing; an argument with a
quote or a line break is refused rather than run
([`cli-invocation.ts`](../../resources/claude-plugins/orca-game/hooks/cli-invocation.ts)).

What is verified where:

- Unit tests, on every OS: each shell's quoting of a path with spaces, `& ^ % ! ( ) '` and
  unicode; the pane-shell choice and the WSL skip; the cmd invocation of a `.cmd` CLI and the
  native spelling of an `.exe` (vitest and `claude plugin test`).
- The Windows CI job (`Windows platform tests`) runs the game suites and `claude plugin validate` /
  `claude plugin test` of the mod on a Windows host.
- Not verified by any automated check, only on a Windows desktop: a real cmd, PowerShell and Git
  Bash pane loading the mod, the band polling `orca.exe`, and a dev build's `orca-dev.cmd` run
  through cmd.exe by Claude Code's engine.

## Configuration layers

To start a project's `orca.yaml` from nothing, run `/orca-game:setup` in a Claude pane of the
repo: it reads what the project uses (tracker keys, MCP servers, `CLAUDE.md` rules, `bin/`
scripts), asks what to integrate one question at a time, shows the YAML, writes it once confirmed
and clears every `orca game state` warning. Its key summary is
[`skills/setup/reference.md`](../../resources/claude-plugins/orca-game/skills/setup/reference.md).

Each field resolves on its own; a later layer wins
([`orchestrator-game-config.ts`](../../src/shared/orchestrator-game-config.ts)):

1. Orca defaults: `mode: on`, `scene: quest`, `hud`, `rewards` and `tracker` all `true`,
   `render: classic`, `timezone: local`.
2. Global Settings → Agents → **Agent Teams game** (`orchestratorGame`).
3. The project's committed `orca.yaml` — owned by whoever owns the repo, a dev or a company.
4. Settings → the project → **Agent Teams game**, this machine only
   (`orchestratorGameProjects[repoId]`). Each row can say **Inherit**.

Both Settings pages group the game's controls (mode, scene, teammate HUD, rewards, work item
tracking, where links open, render and time zone) under an **Agent Teams game** heading that says they apply only to Claude Agent Teams
panes. Under the scene picker a preview paints the effective scene with the mod's own drawing code
([`OrchestratorGameScenePreview.tsx`](../../src/renderer/src/components/settings/OrchestratorGameScenePreview.tsx)
imports `hooks/scene.ts`, `scenery.ts`, `scenes/` and, for `render: hd`, `scene-hd.ts`), so it
cannot drift from what a pane draws in the effective render:
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
  mode: zen # on | zen | off
  scene: quest # quest, vigilante, jrpg, tamer, or a plugin scene: <publisher>.<id>/<scene id>
  sceneFile: .orca/scenes/mario.json # optional: the project's own scene; wins over scene (below)
  hud: true # teammate band above the prompt
  rewards: false # XP, level-ups, celebrations
  tracker: true # follow the linked work item in the flow
  openLinks: system # orca (default) | system: where the game's links open
  render: hd # classic (default) | hd: see "Render: classic or hd" below
  timezone: America/Bogota # local (default) | an IANA zone: when hd turns to night
```

`openLinks: system` opens every game link (PR, CI, ticket, activity, the PR and To Do list
headers, project links) in the desktop's default browser, where the person is signed in to GitHub
and Jira; Orca's own browser has no such session, so a private repo shows a 404 there. The mod asks
Orca with `orca game open-link <url>` (RPC `game.openLink`, http(s) only, Electron's
`shell.openExternal` on macOS, Linux and Windows). A host with no desktop (`orca serve`) or an Orca
older than the mod refuses it, and the link opens in an Orca tab as before. Settings shows it as
**Open links in** (Orca / System browser), globally and per project.

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
- `project` (optional) — `{ reviews, todo }`, my open work across the whole repo, not only this
  worktree's (see [My PRs and To Do](#my-prs-and-to-do)). Each list is
  `{ provider, total, url, items }` or `null`; `items` holds the first 5 as
  `{ id, title, url, status?, tone? }` and `url` opens the full list. `tracker: false` leaves
  it out.
- `stopped` (optional) — the project's persistent STOP as `{ since, by }`, or `null` when it is
  clear; one whose state cannot be read is `{ since: null, by: null, unreadable: true }` and counts
  as set (see [The shared board](#the-shared-board-events-stop-and-inboxes)). A host older than it
  sends none. The mod does not draw it yet.
- `inboxes` (optional, the lead only) — `{ key, unread, last }` per inbox, the lead's (`key: lead`)
  first, then each ticket's, at most 20; `last` is `{ at, from, subject }` or `null`.

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
  project link, `a` the calling pane's activity (else the first one linked), `g` my PRs and `t`
  my To Do. Each runs
  `orca tab create --url <url> --worktree id:<worktree> --json`, so it opens in an Orca browser
  tab of the worktree on every platform, and a toast says when Orca could not. The menu keeps `r`
  (Refresh) and `q` (Close); Pet is `p`.

## My PRs and To Do

The band also shows two project-wide chips, so a lead on `main` with no PR of its own still sees
the team's open work. Both are read in the main process and cached for 90 seconds per repo and
source, so polling never multiplies GitHub or tracker calls
([reader](../../src/main/runtime/orchestrator-game-project-work.ts)).

- **`⇄ #471`** — each of my open PRs on GitHub (`author:@me is:pr is:open`), up to 3, as its own
  chip that opens that PR. A fork is searched with its `upstream` remote, since own work lives on
  the fork and contributions upstream; the list then opens one search over both. Each chip is
  colored by its CI (red failing, yellow running, green passing). The first 5 get their CI (one checks call each, cached 60 seconds by `gh`). The worktree's own PR
  is left out, since its review chip already shows it. When more are open than the band draws,
  or none are, **`⇄ My PRs N`** opens the host's list in the worst color. On GitLab it is
  **My MRs**, the project's open merge requests.
- **`☐ To Do N`** — my open tickets. Done and cancelled items are left out. Opens the tracker's
  "assigned to me" view.

Where the To Do comes from, first match wins:

1. `orchestratorGame.todo` in project Settings or `orca.yaml`:

   ```yaml
   # orca.yaml
   orchestratorGame:
     todo:
       provider: plane # plane | jira | linear | github | gitlab
       project: e665c0d5-22e7-495e-9ecf-3effee3ae370 # optional: Plane project id, Jira key, Linear team key
       workspace: ab2web # optional: Plane workspace slug, Jira site id or Linear workspace id
       action: jira # optional: the command or id of an action the To Do link runs instead
   ```

   With `action`, the To Do chip, the Panel's To Do heading and its `t` link run that action
   (one of the project's `actions` by its `command` or id, or a lead button like `lead:status`)
   instead of opening the tracker's list, so the lead shows the To Do with whatever the project
   uses (a CLI, an MCP server). An action that does not exist is reported in `orca game state`
   and the link opens the list as before.
   The PR list takes the same key, `orchestratorGame.reviews.action` (for example
   `reviews: { action: prs }`): the **My PRs** chip, the Panel's My PRs heading and its `g` link
   then run that action instead of opening GitHub's or GitLab's list.
   Without `workspace` Orca uses the workspace or site selected on its Tasks page. `todo: off`
   hides the To Do and keeps the PRs. A Jira `project` must be a project key (`CIN`),
   since it goes into the JQL.

2. The Plane project this repo was last launched from on the Tasks page.
3. The tracker of the worktree's linked item (a Jira or Linear item scopes to its key's prefix).
4. Issues assigned to me on the repo's GitHub or GitLab.

The Fleet pane lists both, each item a link colored by its CI or status, with hotkeys `g` (my PRs
list) and `t` (To Do list). `/quest demo` shows them with fake data. A provider that fails costs
only its own chip.

## Actions: buttons and slash commands

A project gives its lead up to 6 buttons ([`orchestrator-game-actions.ts`](../../src/shared/orchestrator-game-actions.ts)).
Each one either sends the lead a prompt as a turn or runs an MCP tool from the mod itself, and
`command` also serves it as `/<command>`:

```yaml
# orca.yaml
orchestratorGame:
  actions: # at most 6; a later layer replaces the whole list
    - label: Test runs # at most 24 characters
      command: test-runs # optional: /test-runs; lowercase, digits and -, up to 24 characters
      key: x # optional: its Panel hotkey, one letter or digit
      prompt: Have members run the Tambora test runs of my QA tickets and report pass/fail.
    - label: Runs
      mcp: { server: tambora, tool: list_test_runs, args: { project: CIN } }
```

- **Prompts** may use the link placeholders; one with no value in this worktree is left out.
- **Lead buttons.** The lead also gets Orca's own five first: Wave, Status, Push, Sweep and Stop
  (`/wave`, `/status`, `/push`, `/sweep`, `/stop`), each a prompt asking it to run the matching
  `orca game` verb ([`orchestrator-game-lead-actions.ts`](../../src/shared/orchestrator-game-lead-actions.ts));
  Stop runs `game stop --all --hold`, so it also holds the project's STOP.
  A member gets none. `orchestratorGame.orchestrator.actions: false` turns them off; a project
  action whose command a lead button already uses keeps its button without the command.
- **Where they show.** The band draws one chip row (`▸ Ola`, `▸ Estado`… in the session language;
  the rest behind `+N`), the Panel an Actions row where each button is `key: label`. An action's
  `key` is its own; the Panel's keys (`r p q`, `g t i o c w a`, `1`–`9`) and a key another action
  took are dropped with a warning, and the button keeps working. An action with no key takes the
  next free letter of `e f h j k l m n s u v x y z b d`. Typing to the lead keeps working as before.
- **Slash commands.** The mod registers each command after a refresh and again when the list
  changes. A name Claude Code refuses (its own `/status`, say) is skipped and noted once; the
  button still works. Text after the command is appended to the prompt: `/wave CIN-1,CIN-2`. An
  MCP command answers with the tool's lines.
- **Settings.** The project's **Actions** section shows the `orca.yaml` list read only; **Edit on
  this machine** starts this machine's list (label, command, prompt or MCP server, tool and JSON
  arguments, checked by the same parser), which replaces the `orca.yaml` one whole. **Inherit from
  orca.yaml** drops it.

## The project lead: `orchestratorGame.orchestrator`

A lead is a session that coordinates and never works a ticket: each ticket goes to one member in its
own worktree and tab, which reports back through Orca orchestration. The keys resolve one by one
through the same layers ([`orchestrator-game-lead.ts`](../../src/shared/orchestrator-game-lead.ts));
project Settings edits all but the two prompts and `rules`, which live in `orca.yaml`
(**Lead buttons** is `actions`).

```yaml
# orca.yaml
orchestratorGame:
  orchestrator:
    autostart: true # a plain session in this project starts as the lead
    cap: 4 # members running at once, 1 to 12; launches past it are refused
    agent: claude # what a member runs, as `orca orchestration worker-start --agent` names it
    model: opus # optional
    effort: high # optional, used only with a model
    label: Orquestador # optional: the lead's name
    launchPrompt: | # optional: what a new member is told; {id} {title} {url} {status}
      Implement {id}: {title}
    pushPrompt: | # optional: what `game push` sends a stopped member; same placeholders
      Continue {id} to the end on your own. Report to your lead when it is done or when only the person can decide.
    rules: Members report TERMINADO CIN-NNN. # optional: appended to Orca's own rules
    actions: false # optional: hide Orca's lead buttons and their slash commands (on by default)
    accounts: auto # optional: default (Orca's own account selection) or auto (see below)
```

A placeholder with no value is left empty; an unknown one drops the key with a warning.

The lead's verbs, run from the lead's terminal
([`orchestrator-game-fleet-verbs.ts`](../../src/shared/orchestrator-game-fleet-verbs.ts)):

- `orca game lead` — the standing rules that make this session the lead (none for a member).
- `orca game launch <ticket> [--repo <selector>] [--prompt <task>]` — one member for one ticket;
  `--repo` starts it in another repo of the project. `--prompt` replaces `launchPrompt` for that
  member (same placeholders), for a task that is not implementing the ticket: a QA or test run, an
  investigation. Per-launch overrides of the lead config (also on `game wave`, for every member it
  launches):
  - `--agent <id>` — any agent Orca knows (`claude`, `codex`, `gemini`, …); an unknown id is
    refused. Another agent than the lead's does not inherit the lead's `model`/`effort`.
  - `--model <id>`, `--effort <level>` — the same values `orchestrator.model`/`effort` take;
    `--effort` needs a model.
  - `--account <email|id|auto>` — the managed account the member runs on, mapped to worker-start's
    `--claude-account` or `--codex-account` by the agent. Only `claude` and `codex` have managed
    accounts; another provider's account, or an account for any other agent, is refused. `auto` is
    the pick below. The result names the agent and the account.
  - A network failure of the launch (runtime unavailable or timed out) is retried twice, 1 s and
    3 s apart, with the same orchestration request id, so the runtime never starts a second member
    for one launch ([`orchestrator-game-launch-retry.ts`](../../src/cli/handlers/orchestrator-game-launch-retry.ts)).
    `game launch` has no `--on`: the member runs on the lead's own Orca, whose accounts it uses (an
    `orchestration worker-start --on` refuses account pins because the server resolves its own).
  - A member started with a model or an effort — from these flags or from the lead's
    `model`/`effort` — gets `ORCA_AGENT_MODEL_PINNED=1` and/or `ORCA_AGENT_EFFORT_PINNED=1` in its
    agent's process env, so a model router outside Orca can leave that choice alone (Jev 0.13.1+
    honors them in game panes only). The same
    holds for every agent and every launch that asks for a model or effort
    (`orchestration worker-start --model/--effort`, a model picked in the composer): Orca sets a pin
    only for a value it was asked for and applied, never for a catalog default it filled in (Codex's
    effort) nor for one the user's own agent arguments override
    ([`agent-launch-pin-env.ts`](../../src/shared/agent-launch-pin-env.ts)). The env rides the same
    channel as Settings' per-agent env, so it reaches an SSH member's remote process too; a resumed
    session is not re-pinned, since Orca does not replay launch-time model flags on resume. With
    `worker-start --on`, the connected server builds the launch, so it pins only from a version
    that has this.
- `orca game fleet` — each member's ticket, state, PR, CI, branch, agent, account, phase
  (`needs-you`, `limited`, `working`, `idle`, `finished`) and next step, with the free slots. A member is **finished** when its PR is
  merged and its ticket is in review or done (or it has none); every other member counts toward
  the cap, even one whose turn ended.
- `orca game wave [<ticket>,...] [--repo] [--dry-run]` — launches the named tickets, or the To
  Do's items still in To Do in list order, up to the free slots. It skips tickets a member holds
  and named tickets already in review, done or cancelled; one already In Progress is launched,
  since a project may move it there first. `game state` carries up to 30 To Do items, sorted
  in progress, QA, to do, so the To Do past the in-progress ones is known to it; the Panel draws 3
  per status heading and counts the rest in "+N more".
- `orca game sweep [--close]` — lists finished members and what each leaves (its worktree, a
  ticket not yet done). `--close` records each in `game history`, then releases each one's dispatch, or closes its terminal when no
  dispatch owns it; an unproven release is reported, never followed by a close. Worktrees stay.
- `orca game push [--dry-run]` — sends `pushPrompt` to idle members; one waiting on a question or
  dialog is reported for the person or the lead, and working ones are left alone.
- `orca game member <ticket|handle>` — one member in one read, bounded to fit a lead's turn
  ([`orchestrator-game-member-report.ts`](../../src/shared/orchestrator-game-member-report.ts)).
  **Now**: state, phase, last tool, linked activity, a usage limit, and its last 20 terminal lines
  without escape codes. **Since launch**: every dispatch of its task (retries included), the last 10
  messages between it and the lead (questions, answers, `worker_done` bodies, 600 characters each),
  its last 10 commits since the base, PR, CI and ticket status. A part Orca cannot read this time is
  listed under `notes` and the rest still prints. The lead's rules have it read this before telling
  the person anything about a member.
- `orca game history [--ticket <id>] [--since <date>]` — the project's members already freed, newest
  first: ticket, repo, branch, agent, account, launch and end time, outcome (`merged`, `qa`,
  `stopped`, `failed`, `limited`), PR and last report. `game sweep --close` and `game stop` write a
  member's record before freeing it; if the host cannot take it (an Orca without history), the
  member is freed anyway and the result says `history not recorded: …`. The records live on the Orca
  host that runs the lead, one file per project (the lead worktree's repo, so SSH and folder projects
  too) under the app's data folder, `orchestrator-game-history/`, keeping the last 200
  ([`orchestrator-game-history-store.ts`](../../src/main/runtime/orchestrator-game-history-store.ts)).
  They are written through `game.historyRecord` and read through `game.history`, two RPC methods a
  host older than this does not have; `game history` then says to update Orca.
- `orca game accounts [--refresh]` — every managed account per agent with its 5h and 7d use and
  reset time, its standing (`free`, `near`, `limited`, `unknown`), when a near or limited one is
  usable again, the tickets of this lead's members running on it, and whether `auto` may pick it.
  No credentials. `--refresh` asks the providers first; Orca reads an inactive account's usage
  lazily, so without it an account can read `unknown`.
- `orca game move <ticket> [--account <email|id|auto>] [--dry-run]` — moves a member to another
  account of its agent (`auto`, the default, excludes the one it is on). A Claude member is switched
  in its own terminal and resumes the same session through Orca's in-place switch
  (`orca account switch --terminal`); a Codex member is stopped and started again in its own
  worktree on the new account, linked to the old dispatch with `--retry-of`. When every other
  account is near or limited, nothing moves and the result says when the first one is back.
- `orca game stop [<ticket>,... | --all]` — ends the named members, or all of them, so no member
  agent keeps running: each live dispatch is stopped, then the member's terminal is closed when the
  stop did not close it (a stopped dispatch can leave its terminal retained). Each member is
  reported stopped, already stopped or failed; the lead and the worktrees are never touched.
  `--all --hold` first sets the project's persistent STOP, then stops every member; the lead's rules
  tell it to run that at once when the person stops everyone ("detén todo y que no sigan").
- `orca game resume` — clears STOP, only when the person says so; it relaunches nothing.
- `orca game events [--ticket] [--since]`, `orca game event <kind> [--text]` and
  `orca game inbox [--ticket] [--unread] [--mark-read]` — the shared board below. The lead's rules
  have it read events and inbox before answering "qué pasó".

### Accounts and limited members

`accounts: auto` (orca.yaml or the project Settings' **Member accounts**) puts each new member on
the managed account of its agent with the most free quota
([`orchestrator-game-account-pick.ts`](../../src/shared/orchestrator-game-account-pick.ts)):

- An account's use is its tightest live window, 5h or 7d; a window past its reset counts as empty.
- At 90% or more of either window it is **near** and skipped, as at 100% (**limited**): a member's
  turn can burn several points of a 5h window, so a launch past 90% would stop mid-ticket.
- Accounts within 5 points of each other tie; the tie goes to the one with fewer of this lead's
  members (including the ones the same `game wave` just launched).
- An account with no usage reading is **unknown** and ranks after every known-free one; when one is
  unknown, Orca refreshes usage once (bounded to 20 s) before picking.
- Only accounts on this host, not custom endpoints (they change the model), whose sign-in did not
  fail are picked. An agent without managed accounts launches on its own login.
- When every account is near or limited the launch is refused with when the first is back.
  `default` (or unset) keeps Orca's own account selection.

A member is **limited** when it stopped (not `working`) and either its account has a window at 100%
that has not reset, or its terminal shows a provider usage-limit message while its account is not
verifiably back under its limit (the same guard Orca's auto-switch uses)
([`orchestrator-game-member-limit.ts`](../../src/shared/orchestrator-game-member-limit.ts)).
`game state` carries it as the member's `limit: { resetsAt }`, and each member's account as
`account: { provider, id, email }`. `game fleet` shows the phase `limited` with `game move` as the
next step, `game push` leaves it alone, and the Panel card turns red with `limited · back in 1h 30m`
(Spanish `limitado · vuelve en 1h 30m`, and the mod's other languages). Every card carries a dim
`codex · ana@…` tag: the email's domain never shows, and the name shortens, then drops, as the card
narrows. If **Auto-switch** is on in Settings, Orca may already have moved a Claude or Codex pane on
its own; the lead's rules send it to `game move` otherwise, or to wait for the reset.

### The lead's XP

A lead on the base branch has no PR or ticket of its own, so its XP comes from its members
([`fleet-rewards.ts`](../../resources/claude-plugins/orca-game/hooks/fleet-rewards.ts)). Each
refresh compares every member in `game state` that runs in its own worktree with the previous
refresh, matched by that worktree's id:

| Event                                           | XP  |
| ----------------------------------------------- | --- |
| a member appears (launched, or took a ticket)   | 10  |
| its PR's CI turns green                         | 20  |
| its ticket moves to a review group (QA, Review) | 50  |
| its ticket moves to done                        | 70  |
| its PR merges                                   | 100 |

The first refresh of a session awards nothing, so a member launched or a PR merged while the lead
pane was closed earns nothing. A member that leaves earns nothing more, and a launch is keyed by
the member's worktree, so the same member returning in a new pane is not a second launch. The
review and ticket awards use the ids the member's own pane gives the same change, so when the lead
and the member share an account (the mod's store is one file per Claude config folder) the ledger
counts it once. A member pane (`role: member`) earns only its own work. Toasts name the member
(`+100 XP · ORCA-12 · #41 merged`), a merge floats `#41 merged!`, and `rewards: false` turns all
of it off. The board's `claimed` event is not in `game state`, so a launch is read from the member
appearing there instead.

## The shared board: events, STOP and inboxes

What one member did or asked outlives its tab and its account, so the lead can answer from it
after a restart. Everything here lives on the Orca host that runs the lead, per project (the lead
worktree's repo, so SSH and folder projects too); a member's calls land on its lead's project even
when it works in another repo (`--repo`), since the host resolves it through the member's dispatch
([`orchestrator-game-board.ts`](../../src/main/runtime/orchestrator-game-board.ts)).

**Events** — an append-only record, kept in the same per-project file as `game history`
(`orchestrator-game-history/`), the last 500
([`orchestrator-game-events.ts`](../../src/shared/orchestrator-game-events.ts)). Each event is
`{ at, kind, ticket, text, by }`, with `kind` one of `claimed`, `pr_opened`, `merged`, `qa_handoff`,
`question_parked`, `failed`, `stopped`, `resumed`, and `by` `lead` or the member's ticket.

- `game launch` (and each launch of `game wave`) posts `claimed` once the member started.
- `game fleet` and `game sweep` post `merged` for a member whose PR is merged and `qa_handoff` for
  one whose ticket is in review. Each carries a key (`merged CIN-1 #41`), and the board keeps one
  event per key, so running them on every turn posts each once (while the key is among the last 500).
- `game stop --hold` and `game resume` post `stopped` and `resumed` when they change STOP.
- A member posts its own with `orca game event pr_opened --text "PR #41"`; it always posts under its
  own ticket, whatever `--ticket` says. A project asks its members for `question_parked` and
  `failed` in its `launchPrompt`.
- A post never fails the command that makes it: an Orca without events just keeps none.

**STOP** — one file per project in `orchestrator-game-stop/`, apart from the history so a damaged
history never reads as STOP ([`orchestrator-game-stop-switch.ts`](../../src/main/runtime/orchestrator-game-stop-switch.ts)).

- While it is set, `game launch`, `game wave`, `game push` and `game move` are refused before they
  touch anything, with when and by whom it was set. A wave reads it again before each launch, so a
  STOP set mid-wave leaves the rest unlaunched.
- It fails closed: a file that exists but cannot be read or parsed, or a STOP read that fails during
  a wave, counts as set. Only a missing file is clear.
- Only the lead sets or clears it; a member's attempt is refused, and the lead is never refused,
  since it is where STOP is cleared. `game resume` reports STOP as still set when the file cannot
  be removed.
- `game stop --all --hold` sets STOP first, then stops every member. A member the stop could not
  end gets an urgent `STOP` orchestration message. If STOP cannot be set (an older Orca, a write
  error), the members are stopped anyway and the result says why, with exit code 1.
- **What Orca does not enforce.** Members are not refused tool calls. Orca's managed hook is
  fire-and-forget: it never reads the hook server's reply, exits 0 on any failure, and on SSH and
  WSL the relay forwards events one way only, so a PreToolUse refusal would need a new blocking
  hook endpoint, a member-only `--settings` launch hook, and relay changes, and it would still
  fail open whenever the hook cannot reach Orca. Stopping the member's agent (`game stop`) is what
  actually ends its work; STOP keeps the lead from starting or pushing another.

**Inboxes** — Orca orchestration mail already outlives a member: messages live in the host's
`orchestration.db` and are never deleted when a terminal closes, a dispatch is stopped or released,
or the app restarts. `game inbox` reads it by party instead of by terminal handle
([`orchestrator-game-inbox.ts`](../../src/shared/orchestrator-game-inbox.ts),
[`orchestrator-game-inbox-source.ts`](../../src/main/runtime/orchestrator-game-inbox-source.ts)):

- The lead's inbox is its terminal plus its current run's mailbox (`run:<id>`, where `worker_done`
  lands); a ticket's is every terminal and `dispatch:<id>` mailbox its members had in the lead's
  current run, closed ones included. The ticket comes from each task's title. Newest first, the last
  50; older mail stays in `orca orchestration inbox`.
- A message is unread until the agent it went to read it (`orchestration check`) or the board's own
  read cursor passed it. `--mark-read` moves that cursor and never marks orchestration mail read, so
  the lead's `orchestration check --wait` still gets every message.
- A `worker_done` lands once: a second one for the same dispatch (a retried send, or the member and
  a watcher both sending its `TERMINADO`) is dropped from the inbox and its count.
- `game state` gives the lead `inboxes` with unread counts; a member reads only its own ticket.

**Mixed versions.** The board adds four RPC methods newer than `game.history`, `game.events`,
`game.eventPost`, `game.stopSwitch` and `game.inbox`, and the optional `stopped` and `inboxes` fields
of `game.state`. A CLI against an older host says to update Orca for `events`, `event`, `inbox` and
`resume`; launches and sweeps there post nothing and see no STOP, since that host cannot hold one.

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
koombea/cineco-orchestrator PR #32. Names are translated to Spanish; the finale is pixel art, in
English or Spanish. PR #32's per-game HUD words and colors, the
Crystal Saga ATB bar, Beast Tamer evolution, the wild encounter while waiting, and each game's
handed-off tile animation are not ported: they need logic beyond what a scene's data can describe.

Each also dresses Jev's advisor ([The cast](#the-cast-a-pet-and-jevs-advisor)): Quest a wizard,
Night Watch the commissioner, Crystal Saga an oracle and Beast Tamer the professor. None has a pet,
so Pet hearts Clawd, the hero, as before.

## Render: classic or hd

`render` picks how the spinner scene is drawn
([`orchestrator-game-render.ts`](../../src/shared/orchestrator-game-render.ts) validates it and
`timezone`; the mod mirrors both in
[`game-render.ts`](../../resources/claude-plugins/orca-game/hooks/game-render.ts)). It resolves per
key like the rest, reaches the pane as `ORCA_GAME_RENDER` and `ORCA_GAME_TIMEZONE` at launch and
through `game state` afterwards, and `/quest render classic|hd` overrides it for the session the way
`/quest on|zen|off` overrides the mode; `/quest` alone prints both. `orca game state` prints
`Render: hd (from project), timezone America/Bogota (from global)`, and an unknown render or a zone
the runtime does not know is dropped with a warning (Settings refuses such a zone on entry).

- **classic** (default): the 5-row pixel art above.
- **hd** ([`scene-hd.ts`](../../resources/claude-plugins/orca-game/hooks/scene-hd.ts)): 9 rows, 10
  once the terminal is 48 rows tall, at native resolution. A sky gradient with the sun or moon and
  its glow, two drifting cloud layers, far scenery fogged toward the sky, a mid layer of hills, near
  trees, cactus, crystals, antennas or flowers scaled to the characters, a pond that mirrors the sky,
  and a textured ground line. Every character (the hero, the party, the pet and Jev's advisor) gets
  a 1-px outline inked from its own palette's darkest colour, a lit and a shaded side and a ground
  shadow, so a scene file's figures keep their colours
  ([`hd-sprite.ts`](../../resources/claude-plugins/orca-game/hooks/hd-sprite.ts)). The outline is
  always a dark ink line: below half the luminance of the figure's darkest colour and below 0.03
  relative luminance, so a palette whose darkest colour is bright (a cyan cape) never reads as a
  glow. The far and mid layers keep at least 8 of CIE lightness from the sky row behind them, on one
  side for the whole layer: darker than a bright sky, lighter than a night sky too dark to sink
  below ([`hd-layer-contrast.ts`](../../resources/claude-plugins/orca-game/hooks/hd-layer-contrast.ts)).

On top of that hd adds:

- **Day and night** from the clock in `timezone`, sampled at start, on
  every refresh and about every 30 seconds: dark from 19:00 to 05:00, light from 07:00 to 17:00, an
  orange tint around 06:00 and 18:00, stars and the moon at night, clouds dimmed with the sky. A
  look authored as night (every Night Watch phase but the handoff) is its own midnight; by day it is
  lifted toward an overcast sky with a sun and lighter scenery, and a dark day look (a red alert, a
  dusk) is lifted just enough that noon still reads as day. Costume colours never change with the
  hour in a night look ([`hd-daylight.ts`](../../resources/claude-plugins/orca-game/hooks/hd-daylight.ts)).
  `local` means the desktop's zone: Orca hands the pane its own IANA zone at launch and
  in `game state` (`sources` still says where `local` came from), so a pane on an SSH host, whose
  clock is usually UTC, turns to night when the person's evening does.
- **Light and particles**: shafts from the sun, bloom around bright pixels, a vignette and softened
  top and bottom rows (the characters are spared both); dust by day, fireflies at night, snow in
  Night Watch, glitter in Crystal Saga and embers over the campfire the hero rests by.
- **Motion**: a four-frame walk with a body bob, breathing at rest, and the party following the hero
  (or sitting by the fire), each member's outline tinted with its state colour (darkened to the same
  ink, so it never glows) with a pulsing `!` over the one
  waiting on you. A member that joins walks in from the right edge; one that leaves walks off; the
  first refresh marches nobody.
- **The lead**: when this pane is the project's lead (`role: lead` in `game state`) the hero wears a
  crown and its label (`orchestrator.label`, else `Lead`) under its feet.
- **Team reactions**, from what each refresh already reads: a reward floats `+N XP` with a gold
  flash, a teammate starting to wait floats `<name> needs you!` in red, a merged review floats
  `#N merged!` with a white flash, and CI turning red flashes red, shakes the scene a column for a
  few ticks and rains from a grey cloud. The first refresh of a session plays nothing (a CI red for
  hours is not news), `/quest demo` draws its party but no floats or marches, and a floating text
  wider than the scene is skipped while one that would cover a cloud rises beside it
  ([`team-events.ts`](../../resources/claude-plugins/orca-game/hooks/team-events.ts)).
- **The thought cloud** carries what the hero says: puffs along its top, a highlight and a shadow, a
  1-px outline and a trail of two bubbles that bobs toward the hero's head. The petted pet speaks
  from it, and Jev's advisor says its words in a cloud of its own at the right edge, which the
  hero's cloud, hearts and floating texts never cover.

Every drawn text goes through one glyph filter
([`rasterGlyphsOf`](../../resources/claude-plugins/orca-game/hooks/game-strings.ts)): invisible marks
are dropped, and anything wider than a cell or outside the Latin, punctuation, box and block ranges
a Raster draws becomes `?`, so an emoji in a caption can never make the terminal refuse the frame.
The art uses only the upper half block and text glyphs that SF Mono, Menlo, Consolas and DejaVu Sans
Mono carry.

The band above the prompt holds 8 rows at most, so its pet scene (the advisor acting while the lead
is idle, Pet without a spinner) stays classic in either render.

**Cost.** At 120 columns, median of 9 rounds of 800 frames with the cells packed: classic 0.126 ms
walking and 0.103 ms at rest (0.136 and 0.114 before hd landed), hd 0.570 and 0.585 ms. The sky
(gradient, sun or moon, glow) is cached by size, look and quantized daylight; the far and mid
silhouettes by size and scroll step; outlined sprites by costume and frame. The pixel and cell
buffers are reused per size, and a tick that draws the frame a Raster already shows sends nothing
([`frame-gate.ts`](../../resources/claude-plugins/orca-game/hooks/frame-gate.ts)).

`pnpm run capture:orca-game-scenes -- [--out <dir>] [--scene-file <json>]`
([`orca-game-scene-captures.mjs`](../../config/scripts/orca-game-scene-captures.mjs)) renders every
built-in scene, and a scene file, in classic and hd, day and night, at 130 and 60 columns to PNGs
through Playwright. They draw the cells the mod hands its Raster in a browser: not terminal
screenshots, since a terminal's font and gamma differ.

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
  every phase in `looks`, `costumes` and `cards`, plus `teller` and `band`, and optionally a
  [`cast`](#the-cast-a-pet-and-jevs-advisor) with its own pet and advisor. Colors are `#rrggbb`
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

## The cast: a pet and Jev's advisor

A scene's optional `cast` adds two characters beside its hero
([`cast-shape.ts`](../../resources/claude-plugins/orca-game/hooks/scenes/cast-shape.ts),
[`orchestrator-game-scene-cast.ts`](../../src/shared/orchestrator-game-scene-cast.ts)). It is the
same block in a project's scene file, a plugin's scene and a built-in one.

```jsonc
"cast": {
  "pet": {                                   // optional: what Pet hearts
    "name": { "en": "Wolf", "es": "Lobo" },  // optional; names the button
    "frames": [                              // 1 to 4 walking frames
      ["W...W", "WWWWW", "WEWEW", ".WWW.", ".W.W."],
      ["W...W", "WWWWW", "WEWEW", ".WWW.", "W...W"]
    ],
    "happy": ["W...W", "WWWWW", "WHWHW", ".WWW.", ".W.W."],  // while it is petted
    "colors": { "W": "#d8d8d8", "E": "#1a1a1a", "H": "#ff5a8a" }
  },
  "advisor": {                               // optional: who stands for Jev; the referee otherwise
    "name": "Golem",
    "frames": [[".GGG.", "GEGEG", "GGGGG", "G.G.G", ".G.G."]],  // 1 to 4 idle frames
    "gestures": {                            // optional: its body while one gesture plays
      "escalated": [".GGG.", "GRGRG", "GGGGG", "GGG.G", ".G.G."]
    },
    "colors": { "G": "#b8b8b0", "E": "#d83a2e", "R": "#ff3b3b" }
  }
}
```

- **Sprites.** A frame is 1 to 7 rows of one width from 1 to 10 printable ASCII glyphs, standing on
  the ground; `.` is transparent and every other glyph needs a color (`#rrggbb` or an integer).
  Every frame of one member, `happy` and each gesture body included, is the size of the first.
  Names follow the card rules (a string or one per language, at most 32 characters).
- **A bad member is left out, not the scene.** Orca drops only the invalid `pet` or `advisor` and
  says why in `warnings` (`Scene file <path>: cast.pet.frames: …; drawn without it`, or
  `game scene <id>: …; drawn without it` for a plugin scene), so a typo never takes the scene and
  its hero away. `orca game scene validate` lists those problems like any other. A gesture key the
  game does not know is ignored, so a scene written for a newer game still loads.
- **The pet** walks behind the hero along its path and sits beside it when the hero rests. The
  button reads `♥ Pet <name>` (Spanish `♥ Mimar a <name>`), or `♥ Pet` (`♥ Mimar`) when the pet or
  the scene has no name, in the band and the Panel (`p`). Pet shows its `happy` frame, makes it hop
  and sprinkles the hearts on it; the hero stays on the ground. A scene with no pet hearts the hero,
  Clawd, as before.
- **The advisor** stands at the right edge of the scene, and the hero and its pet walk only the
  stage left of it. It is there only while Jev's `AdvisorState` (`version: 1`) is readable in that
  pane and the game draws other plugins' lines (`absorbing`: mode not `off`, HUD on); without Jev
  there is no advisor and no gap. It acts out what changed, never every frame: a new decision, CI
  state or block notice plays its gesture and bubble for about five seconds (a red card about
  eight), then it goes idle. While the lead is idle and no spinner draws the scene, a gesture brings
  the scene up above the band for as long as it plays (in zen, not for a routine one), as Pet does.
  The first value it sees is where things stand and plays nothing, and a value already acted out
  never plays again, even if a later read brings it back. When
  several changes arrive at once the most important plays: escalation, CI failure, CI success,
  lowered or raised, unsure, CI running, then approved.

| Jev                                             | Gesture                 | The advisor holds                | Bubble                    |
| ----------------------------------------------- | ----------------------- | -------------------------------- | ------------------------- |
| subagent `why: lowered`                         | `lowered`               | an arrow pointing down           | its model · Jev's verdict |
| subagent `why: raised`                          | `raised`                | an arrow pointing up             | its model · Jev's verdict |
| `chosen`, `same`, `explicit`, `inherited`       | `approved`              | a thumbs-up and a whistle's toot | its model · Jev's verdict |
| `kept-unsure`, `measuring`                      | `unsure`                | a yellow card and a magnifier    | its model · Jev's verdict |
| a new `block` notice                            | `escalated`             | a red card and a long whistle    | the notice                |
| a CI run `watching`                             | `ciRunning`             | a stopwatch                      | the run's line            |
| a CI run `success` / `failure`                  | `ciPassed` / `ciFailed` | a green / red flag               | the run's line            |
| the main conversation's model or effort changes | `approved`              | a thumbs-up                      | `model·effort`            |

Other `why` values (`kept-pointer`, `teammate`, `no-jev`…) play nothing but still reach the Panel.
The bubble keeps only width-1 characters, so an arrow or CJK text in Jev's words is left out. In
`/quest zen` the routine `chosen` and `same` decisions play their gesture without a bubble.

- **The Panel card** names the advisor, its main `model·effort` and Jev's line, and lists Jev's
  last five decisions with their verdict, colored by gesture; before the first one it lists the
  agents running now. The decisions live in the game's own `$.state`
  `{ plugin: 'orca-game', key: 'advisor' }` (`{ decisions: [...] }`), written when Jev writes its
  value.

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
  running subagent (title, model, verdict), its CI rows and its latest notice. Any other version, or
  a value that is not an advisor, is ignored, so a newer Jev draws no row rather than a wrong one. The band redraws when that
  value is written; nothing polls it. The same value puts Jev's advisor in the scene and its card
  in the Panel ([The cast](#the-cast-a-pet-and-jevs-advisor)).
- **Following the game.** The game publishes `{ plugin: 'orca-game', key: 'absorbing' }`, a
  `boolean` true exactly while it draws other plugins' lines (mode not `off`, HUD on), at load and
  on every change: the env, Orca's live config and `/quest`. Jev reads it, so a pane where the game
  stops drawing (`/quest off`, the HUD turned off in Settings) shows Jev's own line again, and one
  where it starts never shows Jev twice. `/quest off` keeps the band (the HUD is its own switch) and
  drops the strip, since the other plugins then draw for themselves.
- **One bad row.** An advisor value Jev extends with a row the strip cannot read loses that row
  only; the rest of Jev still draws. Any other `version` draws no Jev row.
- **Stale lines.** Each session starts with no held status, so a plugin that was disabled, reloaded
  or crashed without clearing its line leaves nothing behind.
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
labels shorten first (`2 working` to `• 2`, the review to `#42 ✗`, Refresh and Pet to their
icon), then chips drop and a `+N` counts them. Below 37 columns the HUD frame has no room for a
teammate, so it becomes one line of text (`Lv 2 · • builder  ! scribe`); above that, teammates the
frame cannot seat are counted as `+N` on its top edge. Widths are measured in terminal cells, so
CJK text in a label (a teammate, branch or ticket name) counts two per character.
