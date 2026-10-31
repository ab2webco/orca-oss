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

A Claude member that `orca game launch` starts, or `game resume-members` restarts or resumes, gets
the same args and env plus `ORCA_GAME_ROLE=member`, so it draws its member band (see
[A member's pane](#a-members-pane)). They go on the member's own startup command, before setup
sequencing wraps it, and under Agent Teams the team launch then adds no lead game on top. A codex
member, an `orchestration worker-start` without the game, an SSH or WSL member and a project with
`orchestratorGame.orchestrator.memberGame: false` (Settings: **Game in member panes**) stay plain.
`game.state` reads no My PRs, To Do or tracker ticket for a member caller: its band shows none of
them and takes the ticket from its own name.

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

### A member's pane

A pane started with `ORCA_GAME_ROLE=member`, or one `game state` calls a member, draws a member
band in place of the lead's: one line with its character, ticket, the phase card it shows, its PR
and CI ([`member-band.tsx`](../../resources/claude-plugins/orca-game/hooks/member-band.tsx)). It has
no Panel, team chips, party HUD or lead buttons, only a menu row on the pane's own colors:
**Collapse** folds the band to that row and takes the scene off the spinner for the session,
**Text** is the lead's text toggle, and **Refresh** reads `game state` again. While the member's
`orca orchestration ask` waits on the lead, a line shows the question (`? Asked <lead>: …`), kept
when collapsed and cleared when the answer returns. Its replies use the same cards as the lead's,
and the scene still draws above the spinner unless collapsed or in text mode.

A local member draws its lead's scene file when its own worktree cannot read it: `.orca/` is often
git-excluded, so a fresh member worktree lacks the file the lead draws, and `game state` reads the
lead's copy through the member's parent pane before falling back to Quest (ORCA-870).

### A member's one-line brief

A member that `game launch` starts in a terminal Orca created is typed one line,
`Read your Orca Lab brief at .orca/briefs/<dispatchId>.md (task <taskId>) and follow it.`, instead
of the dispatch preamble. The preamble, with its lifecycle commands, IDs and capability, is written
to that file in the member's workspace on the host that runs its PTY: the local disk (a WSL
worktree through its `\\wsl.localhost\…` path), or the SSH connection's filesystem
([`dispatch-brief-delivery.ts`](../../src/main/runtime/orchestration/dispatch-brief-delivery.ts)).
The line names the file relative to the member's cwd, so the member reads it from its own side of
WSL or SSH. A repo a remote Orca runtime hosts, or a local path this machine cannot write as
given, gets the full preamble. `.orca/briefs/`
carries its own `.gitignore` (`*`), so the brief never shows in `git status`; locally the file is
`0600`. This holds for any agent and host, folder workspaces included. The member's mod draws the
line as a **Brief received** block naming the file.

The full preamble is typed as before when the member is not a game member, the project turns
**Game in member panes** off or the mode is `off`, the terminal was passed in rather than started
by Orca, or the brief cannot be written (no workspace, no SSH filesystem, a failed write). The host
that runs `worker-start` decides, so an older host types the preamble as it always did. A later
`orchestration dispatch` to a member that is already running still types the full preamble.

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

To read what a pane resolved, run `/orca-game:state` there: the mod runs `game state --json` through
the CLI Orca handed the pane (`ORCA_GAME_CLI`, through `cmd.exe` for a Windows `.cmd`, so no pane
shell is involved) and prints each setting with the layer that set it, the mode and render
this session set itself, the lead and its members with their slots, a held STOP, warnings and links
([`state-report.ts`](../../resources/claude-plugins/orca-game/hooks/state-report.ts)). In a session
Orca did not start with its game it says so instead. Every game command lives under `/orca-game:`
(`state`, `view`, `mode`, `render`, `demo`, `quest`, `setup`, `lead`), each a plugin skill the mod answers
without a model turn, because the engine refuses a `:` in a name a mod registers; `/quest` stays as
the mod-registered short form that runs mid-turn. Project buttons (`actions[].command`) keep the
names the project chose.

Each field resolves on its own; a later layer wins
([`orchestrator-game-config.ts`](../../src/shared/orchestrator-game-config.ts)):

1. Orca defaults: `mode: on`, `show: true`, `scene: quest`, `hud`, `rewards` and `tracker` all `true`,
   `render: classic`, `timezone: local`.
2. Global Settings → Agents → **Agent Teams game** (`orchestratorGame`).
3. The project's committed `orca.yaml` — owned by whoever owns the repo, a dev or a company.
4. Settings → the project → **Agent Teams game**, this machine only
   (`orchestratorGameProjects[repoId]`). Each row can say **Inherit**.

Both Settings pages group the game's controls (**Show the game**, **Default view** with each view's cost, scene, teammate HUD, rewards, work item
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

`flat` draws no `Raster` and blits nothing (its gates are `isSceneMode` in
`hooks/quest-policy.ts`); the HUD and the Panel's cards become the text lines of
`hooks/flat-view.ts`, from the same `orca game state` poll. A pane switches to it with the band's
`≡ Text` / `▦ Scene` chip, the Panel's `0` key or `/orca-game:mode flat`, and since ORCA-689
`orca.yaml` and Settings can store it too. A mod older than flat reads a stored `flat` (or an
`ORCA_GAME_MODE` of `flat`) as unknown through `isQuestMode` and keeps drawing the scene.

`show: false` (**Show the game**) hides the game and keeps `mode` as the view it comes back to:
the pane launches as plain Claude and `orca game state` reports `mode: off`, sourced from the layer
that set `show`.

### Views

The view switcher names one list of views
([`orchestrator-game-view.ts`](../../src/shared/orchestrator-game-view.ts), mirrored by the mod's
`hooks/game-view.ts`): `off` and `flat` (light), `zen` and `2d-classic` (medium), `2d-hd` (heavy);
the 3D views join with ORCA-683. A view is stored as the `mode` and `render` keys, so older files
and mods keep working: `2d-classic` is `mode: on` + `render: classic`, `2d-hd` is `mode: on` +
`render: hd` (an `hd-compact` look is kept), and the others set `mode` alone. The suggested view is
one rule on the host's memory in `suggestedOrchestratorGameView`: `flat` at 8 GiB or less, or
under 2 GiB free; `2d-classic` up to 16 GiB; `2d-hd` above. `orca game state` carries it as
`suggestedView` (read at most once a minute) next to `viewScopes`, the scopes the host can store a
view in for this pane: `project` only when the pane's worktree has a repo, and `global`.

`orca game view <view> --scope project|global` (RPC `game.setView`) stores a view beyond the pane:
`project` writes the repo's own layer on this machine (`orchestratorGameProjects[repoId]`, what
Settings → the project edits, shown as `this machine`), `global` writes the global Settings layer.
It never writes `orca.yaml`. Picking a view other than `off` also sets `show: true` in that layer
when the game was hidden there. An open Settings page shows the change at once
(`settings:changed`); panes see it on their next `game state` poll.

In a pane, `/orca-game:view` lists the views with their cost, the current one (`●`) and the
suggested one (`★`); `/orca-game:view <view> [pane|project|global]` switches it (`hooks/view-command.ts`,
`hooks/view-switch.ts`). `pane`, the default, is a session override like `/orca-game:mode` and
`/orca-game:render`, which stay as they were and map to the same views. `project` and `global` run
`orca game view` and then drop this pane's override, so the pane follows what it stored and any
later change from Settings. When the state carries no `viewScopes` (an older Orca) or the CLI
refuses the command (an older `orca` on an SSH host), the view applies to this pane only and the
reply says so.

The Panel's menu has the same selector (`hooks/view-picker.tsx`): `◐ View: <current>` opens a row
of scope chips (this pane, and the scopes Orca can store) and a row of view chips with their cost,
`●` on the current view and `★` on the suggested one. A pick goes through the same `switchView` as
the command, closes the selector and names the result in a toast. On a phone both rows are tap
chips, and the menu takes two rows of chips at about 40 columns.

```yaml
# orca.yaml
orchestratorGame:
  mode: zen # on | zen | flat | off
  show: true # false hides the game and keeps mode for when it is shown again
  scene: quest # quest, vigilante, jrpg, tamer, or a plugin scene: <publisher>.<id>/<scene id>
  sceneFile: .orca/scenes/mario.json # optional: the project's own scene; wins over scene (below)
  hud: true # teammate band above the prompt
  rewards: false # XP, level-ups, celebrations
  rewardWeights: # XP per reward, 0 to 1000; 0 turns one off (see "The scoring table" below)
    ci-green: 10
    member-claimed: 0
  tracker: true # follow the linked work item in the flow
  openLinks: system # orca (default) | system: where the game's links open
  render: hd # classic (default) | hd | hd-compact: see "Render: classic, hd or hd-compact" below
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

`rewardWeights` merges key by key like `orchestrator`: the project can lower one reward in
`orca.yaml` while a dev turns another off in the project's Settings JSON. Like the lists below it
has no Settings editor.

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
([builder](../../src/main/runtime/orchestrator-game-state-builder.ts)). Members also get
`ORCA_WORKTREE_SLUG` to keep parallel test suites apart
([pattern](./worktree-test-resources.md)). The state contains:

- `config`, `sources`, `warnings` — the resolved layers above;
- `agents` — the worktree's agent rows (`working`, `waiting`, `idle`, `done`, current tool,
  leader flag, and an optional `terminalHandle` when the pane maps to an Orca terminal). The Fleet
  pane's **View** button (hotkeys `1`–`9` by tile order) runs `terminal focus` on that handle;
  a row without one gets no button;
- `review` — the hosted review for the branch from any supported provider (GitHub, GitLab,
  Bitbucket, Azure DevOps, Gitea) with its aggregate CI status. `verdict` (optional) is the
  host's review decision — `approved`, `changes_requested` or `review_required` (GitHub only;
  absent without a decision). GitHub reviews also carry, read together in one GraphQL query per
  PR version: `ciHistory` (`{ headSha, ci }` per pushed head, oldest first, including heads a
  force-push replaced), `commentCount` (review comment threads; conversation comments are left
  out, since bots post there) and `reopenCount`. Another provider, an unreadable repository or a
  failed read leaves all three out. `perfectMerge` (optional) is the perfect-merge decision the
  arcade reads (see [The perfect merge](#the-perfect-merge));
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
- `rewardWeights` (optional) — XP per reward kind after every layer (see
  [The scoring table](#the-scoring-table-orchestratorgamerewardweights)). A host older than it
  sends none and the mod awards the defaults; the mod keeps only known kinds with a whole number
  from 0 to 1000.
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

## Panel layout

The Fleet pane's sections are Team (the cards and the advisor card), Review (the review and work
item rows), My PRs, To Do and Actions, in that order. A new Panel shows only Team and My PRs; the
other three are widgets in the catalog that a person adds from the **Widgets** menu chip or with
`/orca-game:layout add <section>`, and removes the same way. In the catalog `●` marks a shown
widget and `○` one that waits; a shown widget also gets `↑` and `↓` chips that move it. Each
heading starts with a mark: `▾` while it is expanded, `▸` once collapsed to its heading line
(`▸ To Do 12`). A click, a tap or Tab and Enter on the mark toggles it; every letter is already a
Panel hotkey, so sections take none. The headings keep their own link or action, and a collapsed
Team turns red while a teammate waits; a collapsed Review keeps its CI color. The `Needs you` lines above the sections are never hidden.
On a phone-width pane each section also gets a touch-sized chip under the menu, and the catalog is
a row of such chips. The Widgets chip has no hotkey: every letter and digit is already taken.

A widget that is not shown is not drawn: its rows, buttons, hotkeys and Team's animated tiles are
gone until it is added, and a closed Actions widget reads no run log. Its data still arrives with
`game state`.

`/orca-game:layout` lists the sections with their state and takes `reset`, `add <section>`,
`remove <section>` and `move <section> up|down` (Spanish words work too: `añadir tareas`,
`quitar equipo`; the older `show` and `hide` still work). The first time a person opens the Panel
a toast says how to collapse sections.

The layout is kept in the mod's `$.store` under `panel-layout`: `{ version: 2, projects: {
<repoId>: { fleet: { order, collapsed, shown } } } }`, so every worktree of one repo shares it
and other people keep their own. `shown` lists what the Panel draws; a section a later build adds
starts in the catalog. Nothing is written until the person changes the layout. A version 1 value
is upgraded on the next write, keeping every section it drew. A damaged value draws the default;
one a newer build wrote is drawn as the default and never overwritten (see
[Game data migrations](./game-data-migrations.md)). Later view settings belong in the same key,
next to `fleet`.

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
list) and `t` (To Do list). `/orca-game:demo` shows them with fake data. A provider that fails costs
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
project Settings edits all but the two prompts, `rules` and `mcpServers`, which live in `orca.yaml`
(**Lead buttons** is `actions`).

```yaml
# orca.yaml
orchestratorGame:
  orchestrator:
    autostart: true # a plain session in this project starts as the lead
    cap: 4 # members running at once, 1 to 100; launches past it are refused. Unset: one per 4 GB of memory and 2 cores, at least 1 and at most 12. With a paired host, the ceiling over every host's cap (below)
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
    accounts: default # optional: auto (unset: the freest managed account, see below), default (Orca's own selection), or a list of allowed account emails or ids
    askBeforeResume: true # optional: ask the person before resuming paused members (resumes at once by default)
    memberGame: false # optional: launch members as plain Claude, without their member band (on by default)
    memberNames: [Mario, Luigi, { en: Peach, es: Melocotón }] # optional: replaces the scene's roster
    mcpServers: [tambora, claude.ai Gmail] # optional: MCP servers every member needs
```

A placeholder with no value is left empty; an unknown one drops the key with a warning.

`mcpServers` makes `game launch` and `game wave` check, before they create anything, that the host
and account a member would run on load each listed server, and refuse by name when one is missing
(`mcp_servers_missing`). The host reads the config that account's Claude reads, so `--on <host>`
answers for the host, and `--account` or `auto` for that account's vault
([`orchestrator-game-member-mcp.ts`](../../src/main/runtime/rpc/methods/orchestrator-game-member-mcp.ts)).
A server counts when it is in that config's user-scope `mcpServers`, in an enabled user plugin, or in
the repo's `.mcp.json`. A claude.ai connector counts when the account has ever connected it, so
`Gmail` and `claude.ai Gmail` both match. The match ignores case. Launch prints `Warning:` and goes on
when the host cannot tell: a Codex member, an SSH repo, a WSL vault, or a paired host whose Orca
predates `game.member-mcp-servers.v1`. `--skip-mcp-check` launches without reading anything.

Each member `game launch`/`game wave` starts is named after the first roster name no live member
holds: `memberNames`, else the active scene's `roster` (every built-in scene ships one), in the lead
pane's `ORCA_GAME_LOCALE`. The name goes before the ticket (`Merlin · CIN-12 Cartelera`), so it
reaches the tab title, `game fleet`, the HUD and the member card. It is freed when the member is
released, and a member gets its ticket alone once every name is taken or the scene has none
([`orchestrator-game-member-names.ts`](../../src/shared/orchestrator-game-member-names.ts)).
The project Settings' **Member names** takes plain names separated by commas. A member on a paired
host (`game launch --on`) takes its name from the same pool: the lead's Orca picks it and keeps it
in the home task title, and the names of every unreleased remote member in its Run DB count as held,
so a local and a remote member never share one.

The lead's verbs, run from the lead's terminal
([`orchestrator-game-fleet-verbs.ts`](../../src/shared/orchestrator-game-fleet-verbs.ts)):

- `orca game lead` — the standing rules that make this session the lead (none for a member).
- `orca game lead --fresh` — rotates the lead: with the outgoing lead's pane closed, Orca retires the
  project's stored lead conversation and this session becomes the new lead instead of reopening it.
  A live lead still wins, and an older host that drops the flag reopens the old one and says so.
- `orca game launch` and `orca game wave` print `Warning:` on stderr when the project's open PRs (the
  PR list's total) reach the cap, and still start the member: finish those PRs to merge first. A PR
  counts even after its member was released, which the live member count cannot see.
- `orca game launch <ticket> [--repo <selector>] [--on <host>] [--prompt <task>]` — one member for
  one ticket; `--repo` starts it in another repo of the project, and `--on` on a paired host (see
  the fleet section below; `--repo` is then the host's repo and required). `--prompt` replaces `launchPrompt` for that
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
    A member launched with `--on` runs on the host's own accounts (ORCA-798): the home sends the
    typed `--account <email|id|auto>`, or `auto` unless the project sets `accounts: default`
    (ORCA-891), with the project's list if any. The host resolves it against its own roster as a
    local launch does (see Accounts). Only a host with no managed account for the agent, and no
    list, runs `auto` on its global login, one member at a time (`global_login_taken`), and the
    result says so (`globalLogin`, `globalLoginHost`). A host older than
    `orchestration.federation-member-account.v1` refuses a typed `--account`, and with the policy
    unset keeps its global login (`globalLoginOlderHost`); one older than
    `orchestration.federation-member-account-allowed.v1` refuses a list's `auto` by name.
    `orchestration worker-start --on` still refuses `--claude-account` and `--codex-account`.
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
- **Per-host caps (ORCA-888).** With a saved environment, the lead's cap is the sum of each
  reachable host's: this Orca's from its memory and cores (one per 4 GB and 2 cores, 1 to 12), each
  paired host's `memberCap` from `status.get`, cached 30 s. A layer's `orchestrator.cap` only caps
  that sum. A host that does not answer adds nothing; an older one publishes no cap, so its members
  take this Orca's slots. `game fleet` prints `Hosts: local 3/5 · imac 4/8`, `game state --json`
  carries `hosts`, `game launch` refuses per host and names one with room, and `game wave` and
  `game resume-members` start members on this Orca only. An explicit per-host cap has no setter yet.
- `orca game wave [<ticket>,...] [--repo] [--dry-run]` — launches the named tickets, or the To
  Do's items still in To Do in list order, up to the free slots. It skips tickets a member holds
  and named tickets already in review, done or cancelled; one already In Progress is launched,
  since a project may move it there first. `game state` carries up to 30 To Do items, sorted
  in progress, QA, to do, so the To Do past the in-progress ones is known to it; the Panel draws 3
  per status heading and counts the rest in "+N more".
- `orca game sweep [--close]` — lists finished members and what each leaves (its worktree, a
  ticket not yet done). `--close` records each in `game history`, then releases each one's dispatch, or closes its terminal when no
  dispatch owns it; an unproven release is reported, never followed by a close. It leaves the worktrees; the lead's
  rules then remove each merged member's worktree and branch with `orca worktree rm`; a member's
  worktree on a paired host with `orca worktree rm --environment <host> --worktree <selector>`, not
  ssh. The host may already have removed a merged tree itself, which reads `No worktree on <host>
matches …` (ORCA-866).
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
- `orca game metrics [--since <date>] [--until <date>] [--ticket <id>] [--character <name>]` — the project's delivery
  numbers, computed client-side from the whole `game.events` and `game.history` stores (no new RPC,
  so an older host answers too): tickets done (a `merged` event, or a member freed as `merged` or
  with a merged PR), lead time per ticket from its first `claimed` to its last merge (falling back
  to the history's `launchedAt`, which is UTC; a ticket with no `merged` event ends when its member
  was freed, marked `ends when freed`), freed members by outcome and event counts. Metrics
  whose fact is not recorded yet (first-time-green, rework, PR size, cleanup, tracker drift, XP,
  achievements) print `not recorded` with what they need, never 0; a note says when a store's cap
  (500 events, 200 records) no longer reaches the window's start. `--character <name>` reads the
  project's saved characters through `game.characters` (only then, so plain metrics still work
  against an older host) and keeps that character's own tasks, the last 20 its progress holds:
  outcomes count its tasks, events are those on its tickets, and a ticket is done only when its own
  task on it is, so a ticket it stopped and another character merged is not credited to it. Lead
  time still runs from the ticket's first claim. It adds the character's level and XP, drops XP from
  `not recorded`, and notes when older tasks are no longer kept. An unknown name is refused with the
  known ones ([`orchestrator-game-metrics.ts`](../../src/shared/orchestrator-game-metrics.ts)).
  With no filter it also prints the scene's metrics widget window: tickets done per calendar day
  for the last 14 days and their median lead time, in `--timezone <zone>` (default this machine's
  zone). Each done ticket counts once, on the day of its `ticketsDoneAt` in `--json` (its last
  merged event, else when its member was freed), so a ticket merged one evening and freed the
  next morning is not counted on both days the way two one-day `--since`/`--until` queries would.
- Game state's optional `metrics` (lead only, absent from an older host or for a member) carries
  that same 14-day summary in the game's own timezone plus each managed Claude account's 5h and 7d
  use (active first, then the busiest, at most 8, readings Orca already holds, never a refresh).
  The host computes it at most once a minute per project and zone; the budget is 2 KB of payload
  and 50 ms of compute on a full store, both tested against a recording of this project's real
  stores ([`orchestrator-game-metrics-summary.ts`](../../src/shared/orchestrator-game-metrics-summary.ts)).
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
  `--on <host> --repo <selector>` moves it to a paired host instead (ORCA-798): a new member starts
  there on `--account` or the project's account policy, resolved by that host; only once it
  starts does the old dispatch stop, without a release, so the old host keeps its worktree and the
  result names it. When that host has every account near or limited, nothing moves and the result
  names when its first account is back. A member already on a paired host moves only this way;
  `--account` alone is refused for it.
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
- `orca game ask-owner --question [--ticket] [--option]... [--context]`, `orca game owner-questions
[--all]` and `orca game answer-owner <id> (--pick <n> | --answer <text>)` — the lead's questions
  to the person as records, below.
- `orca game resume-members [<ticket>,...] [--discard] [--dry-run]` — brings back the members a
  restart left paused, below.

### Decisions, the wait and the owner's rules

The lead answers what its members ask, and the person hears only what only they can decide. The
lead's rules ([`orchestrator-game-lead-brief.ts`](../../src/shared/orchestrator-game-lead-brief.ts))
state the bar:

- **The wait** includes `decision_gate` beside `worker_done`, `escalation` and `question`, so a
  member that blocks on a gate reaches the lead without a second monitor.
- **Answers.** The lead answers a question or a gate with `orca orchestration reply`. If that fails, it
  sends the answer to the member's terminal handle with `orca orchestration send --to`, and runs
  `orca game push` when the member is idle. Each answer is recorded as a comment on the member's ticket.
- **The person decides** releases and publishing, spending money or quota beyond the plan,
  hard-to-reverse or outward-facing actions (force pushes to shared branches, deleting work,
  credentials, repo visibility), and scope or product direction. Everything else the lead decides
  itself and records on the ticket.
- **The advisor.** When the lead's agent offers an advisor tool, the lead consults it once for a hard
  technical call, never for a status update. Without one, the lead decides by the bar above.
- **Members keep working.** An idle member with no PR in flight is a lead failure: the lead gives it
  its next step or frees its slot.
- **Finish before starting.** The lead drives each member to merge before it launches another ticket;
  new launches only fill slots freed by merged work. The lead removes a merged member's worktree and
  branch right away, so no unfinished or merged workspaces pile up.

### One setup at a time

A member's new worktree runs the project's setup (`pnpm install` and the like). Four of them at once
next to five agents force-quit Orca Lab on a 16 GB Mac (ORCA-746), so `game launch`, `game wave` and
`game resume-members` (when it needs a new worktree) ask `orchestration.workerStart` to queue the
start with `setupAdmission: 'queue'`
([`worker-setup-admission.ts`](../../src/main/runtime/orchestration/worker-setup-admission.ts)):

- **One per host.** The host starts one such member at a time per setup host: this machine, or
  each SSH connection. The next one starts when the previous setup command ends, when an agent that
  waits for setup sees it end, at once when the worktree runs no setup, or after 20 minutes at most.
- **Memory.** On this machine the head of the queue also waits for room: macOS must not report
  `warn` or `critical` memory pressure; elsewhere a fifth of physical memory, at least 2 GiB, must be
  free. An SSH host's memory is its own, so it is not checked here.
- **The launch returns at once.** A queued start answers `state: 'queued'` with its place and what it
  waits on, and creates no dispatch yet, so its task stays ready. The host starts it later by
  itself; if that start fails, the lead gets a `Queued start of <member> failed: <reason>` message.
  `game launch` prints `queued #<n>, waiting on <what>; it starts by itself` and does not fail.
- **In the game state.** Queued members are `queuedMembers`, never `pausedMembers`; a start that
  holds the slot is neither. They keep their ticket and slot: `game launch` refuses the ticket,
  `game wave` skips it (`queued`), and `game fleet` lists them under `Queued behind a setup`.
- **After a restart** the queue is gone, the task is still ready, and the member shows as paused;
  `game resume-members` relaunches it into the queue.
- **Mixed versions.** The runtime advertises `orchestration.worker-setup-queue.v1`; against a host
  without it the CLI says the setups run at the same time and launches at once, as before.

### Paused members after a restart

When Orca Lab closes or the machine restarts, each member's agent stops with it. The lead's members
are saved while they run, so the team picks up where it was:

- **What is saved.** One file per project on the Orca host that runs the lead, under the app's data
  folder, `orchestrator-game-members/`
  ([`orchestrator-game-member-session-store.ts`](../../src/main/runtime/orchestrator-game-member-session-store.ts)).
  Per ticket: name, orchestration run, task and dispatch, worktree and branch, agent, managed
  account, the agent's conversation id and its last state. `game launch` saves the member before its
  worker starts and again after, so a launch cut short is still found; every `game state` read by the
  lead fills in the conversation id and state of each live member
  ([`orchestrator-game-paused-members.ts`](../../src/main/runtime/orchestrator-game-paused-members.ts)).
  Writes are fsynced before the rename, since this file exists for the crash that loses a plain one.
- **Paused.** A saved member that is not live now, and whose worktree runs no agent, is paused.
  `game state` gives the lead `pausedMembers`, and `game fleet` lists them under
  `Paused since Orca or the machine restarted`. A paused member keeps its ticket and its slot:
  `game launch` refuses its ticket and `game wave` skips it (`paused`), so a ticket never gets a
  second member. A member whose PR merged or whose dispatch reported success is never paused, and
  `game sweep --close` and `game stop` forget the members they free.
- **Worktree gone.** A paused member whose repo answered without its saved worktree carries
  `worktreeGone` ([`game-member-worktree-presence.ts`](../../src/main/runtime/game-member-worktree-presence.ts));
  a repo that could not be scanned, such as an SSH host offline, never marks it. It frees its slot,
  `game fleet` lists it under `Cannot resume, worktree gone`, and `game resume-members` reports it
  `unresumable` with the `--discard` command, without binding a run or failing the exit code, so a
  lead start no longer retries it (ORCA-832).
- **Resume.** `game resume-members` takes the paused members in turn, one at a time and never past
  the cap ([`orchestrator-game-member-resume.ts`](../../src/main/runtime/orchestrator-game-member-resume.ts)):
  - It first binds the run that owns their tasks; it never takes that run over while this lead
    leads live members in another, and says so.
  - A Claude member reopens its own conversation (`claude --resume`) in its worktree, on the
    account it ran on, and Orca waits until Claude is up; any other agent, a launch cut short, or a
    conversation Claude cannot reopen gets a new agent on the same task in its worktree (a new child
    worktree when none was created). Either way the member gets a fresh dispatch on its own task,
    with a new preamble, so its `worker_done` and mail reach this lead even when the lead's terminal
    changed.
  - A member whose task completed is reported finished and forgotten; one whose worktree or task is
    gone, or whose task is still marked dispatched from before the restart, is reported and kept,
    with nothing started. A failed or blocked task is retried from its latest dispatch.
  - A launch cut short before its worktree was saved finds that worktree through its task's worker
    record, so it is reused, never orphaned. When the new dispatch cannot be bound, the reopened
    conversation is closed again, so no agent runs that no dispatch owns.
  - The lead's rules have it run `game resume-members` at once and then tell the person who resumed
    (ORCA-746). `askBeforeResume: true` (orca.yaml, or the project Settings' **Ask before resuming**)
    keeps the earlier rule: ask the person once, naming the members, before resuming.
  - A ticket is resumed once even when two leads ask together: a second call within two minutes of
    the first (the time the CLI takes to bind the new dispatch) is refused with `already being
resumed`, so two agents never reopen in one worktree. Each Orca host keeps this claim in memory.
- **The lead's brief** (ORCA-746). When a lead's own conversation is resumed or compacted, the
  orca-game mod hands it `game fleet` as context, paused members included, so it answers from the
  host's record and not from a summary; after a compaction it also points the lead back to
  `game lead` for its rules ([`lead-brief.ts`](../../resources/claude-plugins/orca-game/hooks/lead-brief.ts),
  Claude's `SessionStart` with `source` `resume` or `compact`). Only a session that ran the lead
  rules, is the project's lead, and has no other live lead gets it; a fresh start reads the fleet
  through the lead skill instead. A resumed lead also runs the lead skill again: a restart killed its
  report watcher, and its rules then resume the paused members or ask first.
- **Discard.** `--discard` frees the named members, or all of them; worktrees are never touched.
- **Their worktrees are guarded** (ORCA-746). `orca worktree rm` (`worktree.rm`) refuses the worktree
  of any saved member that has not finished, paused or live, even with `--force`, which only waives
  the dirty-tree check. The refusal (`game_member_worktree`) names the member and lists up to 20
  commits no remote has, then says how to resume or `--discard` it; `--force-member` removes it
  anyway and returns the same list as a warning
  ([`game-member-worktree-guard.ts`](../../src/main/runtime/game-member-worktree-guard.ts)). The
  merged-worktree sweep (`config/scripts/merged-worktree-close.mjs`) never falls back to
  `git worktree remove` after that refusal. The desktop's own delete dialog does not go through
  `worktree.rm` and is not guarded.
- **A file this Orca cannot read** (damaged, or from a newer Orca) is never read as empty nor
  written over: Orca starts normally, `game fleet` says `Could not resume members: <reason>`, and
  nothing is saved until `game resume-members --discard` sets a damaged file aside, bytes kept,
  under a `.unreadable-<time>.json` name. A file from a newer Orca is left where it is, so going
  back to that Orca still finds it; updating Orca is the way to resume those members. Unknown keys
  survive a rewrite (see [`game-data-migrations.md`](./game-data-migrations.md)).
- **Mixed versions.** `game.memberRecord`, `game.memberResume` and `game.memberDiscard` are new RPC
  methods, and `pausedMembers`/`pausedMembersError` new optional fields of `game.state`. A newer
  CLI's launch against an older host saves nothing and launches anyway; `game resume-members` there
  says to update Orca.

### Accounts and limited members

`accounts: auto`, also when unset (orca.yaml or the project Settings' **Member accounts**), puts
each new member that `game launch` or `game wave` starts without `--account` on the managed account
of its agent with the most free quota
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
- An account one of whose members stopped on a limit (see below) is **limited** until that limit
  resets, whatever its 5h and 7d readings say: a spend limit is not in those readings (ORCA-896).
- `accounts: [a@example.com, acct_id]` restricts `auto`, `--account` and `game move` to the
  accounts listed (emails or ids); with none of them usable the launch is refused, never moved to
  the global login. Settings can only override the list with `default` or `auto`.
- The launch prints the account picked, its 5h and 7d use, and each account it skipped and why.
- When every account is near or limited the launch is refused with when the first is back.
- A launch never falls back to the host's global login (`~/.claude`, `~/.codex`) while the agent
  has managed accounts: Orca cannot refresh, `game move` or `account switch` a member there
  (ORCA-809). When none of them is usable the launch is refused and says to name one with
  `--account`. With no managed account at all, one member runs on the global login and the launch
  says so; a second is refused until it is gone. `game fleet` shows such a member's ACCOUNT as
  `global login` (`globalLogin: true` in `game state` and `--json`; an older host sends none).
- `default` keeps Orca's own account selection, which can be the global login. A member placed
  with `--on` follows the same rules on its host, from that host's roster (see `game launch`
  above); a paired host's member never counts against this host's global login.

A member is **limited** when it stopped (not `working`) and either its account has a window at 100%
that has not reset, or its terminal shows a provider usage-limit message while its account is not
verifiably back under its limit (the same guard Orca's auto-switch uses). A spend-limit message
(`spend limit`, `/usage-credits`) keeps it limited even then, since no reading counts spend
([`orchestrator-game-member-limit.ts`](../../src/shared/orchestrator-game-member-limit.ts)).
`game state` carries it as the member's `limit: { resetsAt }`, and each member's account as
`account: { provider, id, email }`. `game fleet` shows the phase `limited` with `game move` as the
next step, `game push` leaves it alone, and the Panel card turns red with `limited · back in 1h 30m`
(Spanish `limitado · vuelve en 1h 30m`, and the mod's other languages). Every card carries a dim
`codex · ana@…` tag: the email's domain never shows, and the name shortens, then drops, as the card
narrows. If **Auto-switch** is on in Settings, Orca may already have moved a Claude or Codex pane on
its own; the lead's rules send it to `game move` otherwise, or to wait for the reset.

A member's account is the one its running Claude reports, not only what Orca recorded at spawn
(ORCA-907). Each status-line post carries the pane's `CLAUDE_CONFIG_DIR`; a managed vault there
names the account `game fleet`, `game move`, the Panel and a paired host's relay show, ahead of the
pane's spawn record and the worktree pin. A post from before an account switch no longer counts.
The same post's 5h and 7d windows decide whether that member is limited when they are newer than
Orca's cached reading, so the card matches the pane's own status line. A stopped member whose last
lines ask for `/login` (`Not logged in`, an expired or revoked OAuth token, Codex's `sign in again`)
is `limit: { resetsAt: null, loggedOut: true }`: phase `needs-you` with
`log <email> in again (/login in its pane), or game move <ticket>`, the card says
`logged out · /login in its pane`, and `game accounts` shows its account as logged out, which
`auto` skips. An older host relays no `loggedOut`, and an older home shows such a member as limited.

### The lead's XP

A lead on the base branch has no PR or ticket of its own, so its XP comes from its members
([`fleet-rewards.ts`](../../resources/claude-plugins/orca-game/hooks/fleet-rewards.ts)). Each
refresh compares every member in `game state` that runs in its own worktree with the previous
refresh, matched by that worktree's id:

| Event                                           | Reward key         | XP  |
| ----------------------------------------------- | ------------------ | --- |
| a member appears (launched, or took a ticket)   | `member-claimed`   | 10  |
| its PR's CI turns green                         | `ci-green`         | 20  |
| its ticket moves to a review group (QA, Review) | `work-item-review` | 50  |
| its ticket moves to done                        | `work-item-done`   | 70  |
| its PR merges                                   | `review-merged`    | 100 |
| its merged PR turns perfect                     | `perfect-merge`    | 100 |

The XP is the default; a project changes it with `rewardWeights` (below).

The first refresh of a session awards nothing, so a member launched or a PR merged while the lead
pane was closed earns nothing. A member that leaves earns nothing more, and a launch is keyed by
the member's worktree, so the same member returning in a new pane is not a second launch. The
review and ticket awards use the ids the member's own pane gives the same change, so when the lead
and the member share an account (the mod's store is one file per Claude config folder) the ledger
counts it once. A member pane (`role: member`) earns only its own work. Toasts name the member
(`+100 XP · ORCA-12 · #41 merged`), a merge floats `#41 merged!`, and `rewards: false` turns all
of it off. The board's `claimed` event is not in `game state`, so a launch is read from the member
appearing there instead.

### The scoring table: `orchestratorGame.rewardWeights`

Every reward comes from a fact Orca observes in two polls of `game state`, never from what an
agent reports (a `worker_done` body or envelope, chat text), so a claim with no matching fact
earns nothing. Each fact is one ledger row keyed by the fact's id, so a restart, a second poll or
another pane that sees the same change writes no second row
([`rewards.ts`](../../resources/claude-plugins/orca-game/hooks/rewards.ts)).

| Reward key         | Earned when                                  | Fact source                                 | Fact id                                   | Default |
| ------------------ | -------------------------------------------- | ------------------------------------------- | ----------------------------------------- | ------- |
| `review-merged`    | the worktree's review turns `merged`         | `review.state` (hosted review provider)     | `review-merged:<provider>#<n>@<worktree>` | 100     |
| `ci-green`         | the review's CI turns `success`              | `review.ci` (aggregate checks or pipeline)  | `ci-green:<provider>#<n>@<worktree>`      | 20      |
| `work-item-review` | the linked work item moves to a review group | `workItem.statusGroup` (tracker)            | `work-item-review:<provider>:<id>`        | 50      |
| `work-item-done`   | the linked work item moves to done           | `workItem.statusGroup` (tracker)            | `work-item-done:<provider>:<id>`          | 70      |
| `member-claimed`   | a lead's member appears in its own worktree  | `agents` (the member's worktree id)         | `member-claimed:<worktree>`               | 10      |
| `perfect-merge`    | the merged review turns perfect              | `review.perfectMerge` (GitHub review facts) | `perfect-merge:<provider>#<n>@<worktree>` | 100     |

`rewardWeights` sets a reward's XP to a whole number from 0 to 1000; `0` turns that reward off
(no row, no toast) and a reward left out keeps its default. An invalid value or an unknown key is
reported in `warnings` and that reward keeps its default
([`orchestrator-game-reward-weights.ts`](../../src/shared/orchestrator-game-reward-weights.ts)).
A row keeps the XP it was written with, so a weight changed later only applies to new facts.
`rewards: false` still turns every reward off. A folder workspace or a worktree with no review
or tracker never sees those facts, so their rewards never fire and nothing is taken away.

The ledger also takes rows that subtract XP, for the quality signals that will cost points
(ORCA-686): the total can go below 0 while the level stays at 1, and the toast and the score line
show the minus sign (`-30 XP`, in red on the flat score line).

### The perfect merge

`review.perfectMerge` is the owner's quality gate (ORCA-686), and the arcade (ORCA-775) reads it to
unlock a play ([`orchestrator-game-state.ts`](../../src/shared/orchestrator-game-state.ts)). It is
absent until the review is `merged` and every GitHub fact above was read, so an open PR, another
provider or a failed read never counts as perfect. Once merged it is `true` only when all of these
hold, and `false` otherwise:

- CI is `success` and no head in `ciHistory` was ever `failure` (a red run before a rebase still
  counts, read from the force-push events);
- the review found nothing to fix: `verdict` is not `changes_requested` and `commentCount` is 0.
  `approved` is not required, since the lead and its members share one GitHub identity and an
  author cannot approve their own PR;
- `reopenCount` is 0;
- the ticket's acceptance is met. The host has no fact for that, so the merge stands for it: the
  lead merges only after checking acceptance.

It earns the `perfect-merge` reward on top of `review-merged` when it turns `true`, which can be a
refresh after the merge, since the facts are read once the PR changes.

**Lead subagents.** The orchestrator lead is a session that ran the lead rules: `orca game lead`,
whether through `/orca-game:lead`, the project's `autostart` or a Bash call of it. Only that session
refuses Claude Code's `Agent` and `Task` subagents (`classic.PreToolUse`,
[`lead-subagent-guard.ts`](../../resources/claude-plugins/orca-game/hooks/lead-subagent-guard.ts)),
and the refusal names `orca game launch`. Agent Teams teammates are never refused: a call that
names a `team_name` or a `name` is one. A plain Agent Teams pane that never ran the lead rules, a
member, and a session before it runs the lead rules are not refused. A subagent that runs in the orchestrator
lead counts as a working teammate in the band and the Fleet pane until its turn completes or it makes
no call for ten minutes ([`lead-subagents.ts`](../../resources/claude-plugins/orca-game/hooks/lead-subagents.ts)).
The lead record is per session, newest 50 ([`lead-started.ts`](../../resources/claude-plugins/orca-game/hooks/lead-started.ts)).

## The shared board: events, STOP and inboxes

What one member did or asked outlives its tab and its account, so the lead can answer from it
after a restart. Everything here lives on the Orca host that runs the lead, per project (the lead
worktree's repo, so SSH and folder projects too); a member's calls land on its lead's project even
when it works in another repo (`--repo`), since the host resolves it through the member's dispatch
([`orchestrator-game-board.ts`](../../src/main/runtime/orchestrator-game-board.ts)). How these
files survive an update or a downgrade, and what a change to them must ship with, is in
[`game-data-migrations.md`](./game-data-migrations.md).

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
- A member's question the lead has not answered stays waiting on the lead after its mail is acked
  (ORCA-746 T6): `game fleet` shows the member's NEXT as `waiting on you: orchestration reply --id <msg>`
  until the question is answered or closed, and `game state` lists it under the lead's inbox.
- What the lead asks the person is a record, not chat text (ORCA-782): `game ask-owner` keeps the
  question with its ticket, up to 6 options, a context line and the time asked in the project's board
  file, next to its events ([`orchestrator-game-owner-questions.ts`](../../src/shared/orchestrator-game-owner-questions.ts)).
  Open ones are never dropped; the last 200 answered stay for the audit. `game state --json` gives
  the lead `openOwnerQuestions`. `game answer-owner` (and later the Inbox) answers once: the host
  writes an `escalation` from `owner` to the lead's terminal, a type the lead's watch passes, and
  the lead records it on the ticket. The same answer again is a no-op, a different one is refused,
  and a member can neither ask the person nor answer for them.
- Members a lead places on a paired host with `orchestration worker-start --on <env>` are part of
  its fleet (ORCA-824): `game fleet`, `game state --json` and `game member <ticket>` list them with
  their host (`HOST`, `remote.host`), and the state, branch and PR the host's `federationShow`
  reports. A host that does not answer within 3 s keeps its member listed with state `unknown`
  and NEXT `worker-show --dispatch <id>`. The fleet holds the lead Run's live remote dispatches and
  those that finished since the current lead claimed the Run. A remote agent started any other way
  (a plain terminal on the host) has no record on the lead's machine and cannot be listed;
  `orca game launch <ticket> --on <host> --repo <selector of the repo on that host>` is the
  game's remote launch: the same roster name, task title, member record and `game: true` as a
  local launch, sent as `worker-start --on <host>` with a `new-top-level` worktree. The host
  starts the pane as a game member (band and character) when it has the game-member capability.
  The lead's Orca also sends the scene file the lead draws, as written, to a host advertising
  `orchestration.federation-game-scene.v1`. The host keeps it on the member's attach record and
  draws it only when the member's worktree has no readable scene file of its own (`.orca/` is often
  git-excluded, so a new host worktree lacks it). An older host draws its own scene, or Quest. A plain
  `worker-start --on` gives the member neither a name nor the game. There is no host repo map
  yet, so `--repo` names the host's own repo.
- The lead's watch is `orchestration check --wait --watch`: a quiet window waits again silently and
  returns only for a message, so an idle hour costs the lead no turn (ORCA-746 T6b).
- A batch the lead's check handed out is not pointed at again ("You have N orchestration messages")
  until the pane restarts; the watch's delivery is the one wake for that event (ORCA-746 T6b).
- While the lead's watch is pending, nothing is pointed at, not even mail outside its `--types`:
  that mail rides in the watch's next batch, ahead of the message that wakes it (ORCA-824). Without
  a pending watch, Run mail is pointed at as before.
- `--types` filters only the Run's own traffic. Mail no member sent wakes the watch whatever its
  type: another lead's `status` reply, the owner. A member is the assignee handle or pane of any
  dispatch in the Run, a remote member's relayed mail (`dispatch:<id>`), or the runtime's own
  `task:`/`run:` notices; their `status` pings still ride in the next batch without waking it
  (ORCA-861).
- A Run's mailbox outlives its lead, so before a check builds a batch (and before the pointer counts),
  mail already settled moves to history: a question answered or closed, or whose dispatch is gone;
  and a `worker_done`, escalation or status from a finished member, sent before the current lead
  claimed the Run (ORCA-824). The check that retired them carries `retired: { count, unverified }`
  and the text output says it in one line; `unverified` lists the retired reports whose PR is not
  merged or closed, so the new lead still verifies them. `check --all` shows the retired mail.
- A `worker_done` lands once: a second one for the same dispatch (a retried send, or the member and
  a watcher both sending its `TERMINADO`) is dropped from the inbox and its count.
- A worker's setup that succeeds sends no mail (ORCA-746): it is recorded on the dispatch
  (`setup_state`, shown by `orchestration worker-show`). A failed setup still mails the run as a
  high-priority `status`. Heartbeats never reach the inbox, its count or the terminal's
  "You have N orchestration messages" line.
- A member's failure (failed setup, first-signal deadline, agent exit, failed `worker_done`) leaves
  the inbox and its count once the same ticket gets past it: a later succeeded `worker_done`, or any
  message from a newer dispatch. Mail from the failed dispatch itself does not hide it, except its
  own "member reattached" notice.
- A member sends one heartbeat when its brief arrives and no loop (ORCA-746): that first signal
  keeps the 11-minute first-signal deadline from failing the dispatch. After it, Orca records the
  member's `last_activity_at` every 30 s from its agent hooks (or terminal output when the agent
  has none), and the coordinator's stale warning reads heartbeat or activity, once per stale spell.
  A federated or SSH-relayed member whose PTY is not on this host has no local activity, so it is
  warned as stale 10 minutes after its last heartbeat: a warning only, never a failure.
- A member the first-signal deadline failed whose terminal keeps working (ORCA-658) is watched
  for 30 minutes after its last activity. Activity later than the failure reopens the dispatch,
  disarming the spent deadline, so its `worker_done` settles the task, unless the task was
  dispatched again or another live member holds the ticket. Then it stays failed. Either way the
  lead gets one message: "member reattached", or "orphaned member still working" (adopt its work
  or stop that terminal). The deadline still fails a silent dispatch at 11 minutes, since host
  activity never clears it in advance; a federated member has no local activity to reopen it.
  While it keeps working, an orphaned member stays in `game fleet` and `game member` (it no longer
  ages out 30 minutes after the failure), with NEXT "orphaned, still working: adopt its work or
  stop it". The fleet's ACTIVE column shows each member's last host-observed activity.
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

Each ships Orca's built-in roster for the scene (`ORCHESTRATOR_GAME_BUILT_IN_ROSTERS`, 12 names; a
mod test pins the two equal) and dresses every name after the first as a
[character](#characters-a-look-per-roster-name) of its own.

## Render: classic, hd or hd-compact

`render` picks how the spinner scene is drawn
([`orchestrator-game-render.ts`](../../src/shared/orchestrator-game-render.ts) validates it and
`timezone`; the mod mirrors both in
[`game-render.ts`](../../resources/claude-plugins/orca-game/hooks/game-render.ts)). It resolves per
key like the rest, reaches the pane as `ORCA_GAME_RENDER` and `ORCA_GAME_TIMEZONE` at launch and
through `game state` afterwards, and `/orca-game:render classic|hd|hd-compact` overrides it for this pane's
session the way `/orca-game:mode on|zen|off` overrides the mode; either alone prints both. The host
never learns of an override, so `game state` keeps reporting the configured value, and both commands
say which is which: `Render: hd (this session; the project's setting is classic, from default).`
`orca game state` prints
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
  orange tint around 06:00 and 18:00, stars and the moon at night, clouds dimmed with the sky. The
  sun crosses the right half of the sky, rising mid-band at dawn and setting at the right edge at
  dusk, highest at noon (the left half is where the hero's and party's thought clouds sit), and the
  moon does the same from 18:00 to 06:00, so dawn and dusk differ by where the disc stands. A
  look authored as night (every Night Watch phase but the handoff) is its own midnight; by day it is
  lifted toward an overcast sky with a sun and lighter scenery, and a dark day look (a red alert, a
  dusk) is lifted just enough that noon still reads as day. Costume colours never change with the
  hour in a night look ([`hd-daylight.ts`](../../resources/claude-plugins/orca-game/hooks/hd-daylight.ts)).
  `local` means the desktop's zone: Orca hands the pane its own IANA zone at launch and
  in `game state` (`sources` still says where `local` came from), so a pane on an SSH host, whose
  clock is usually UTC, turns to night when the person's evening does.
- **Particles**: dust by day, fireflies at night, snow in Night Watch, glitter in Crystal Saga and
  embers over the campfire the hero rests by. Nothing blends a pixel into its neighbours (no bloom,
  vignette, sun glow, light shafts or haze on the far scenery), so every edge stays as hard as
  koombea-quest's: both draw `▀` half blocks in truecolor, and those passes were the difference.
- **Motion**: a four-frame walk with a body bob, breathing at rest, and the party following the hero
  (or sitting by the fire). Walking, the pet goes right behind the hero and the party behind the
  pet, always on the hero's left since no figure is mirrored, and the hero's path starts where all
  of them fit; a narrow stage closes the party up (down to 8 columns apart, then without the
  hero's prop) and draws only the teammates that fit whole
  ([`hd-party.ts`](../../resources/claude-plugins/orca-game/hooks/hd-party.ts)). Each member's outline tinted with its state colour (darkened to the same
  ink, so it never glows) with a pulsing `!` over the one
  waiting on you. A member that joins walks in from the right edge; one that leaves walks off; the
  first refresh marches nobody.
- **The lead**: when this pane is the project's lead (`role: lead` in `game state`) the hero wears a
  crown and its label (`orchestrator.label`, else `Lead`) under its feet.
- **Team reactions**, from what each refresh already reads: a reward floats `+N XP` with a gold
  flash, a teammate starting to wait floats `<name> needs you!` in red, a merged review floats
  `#N merged!` with a white flash, and CI turning red flashes red, shakes the scene a column for a
  few ticks and rains from a grey cloud. The first refresh of a session plays nothing (a CI red for
  hours is not news), `/orca-game:demo` draws its party but no floats or marches, and a floating text
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

- **hd-compact**: the hd scene, figures and effects in a fixed 7-row band (`HD_COMPACT_ROWS`) that
  does not grow with the pane, for people who want hd without its height. Below 8 rows there is no
  room above the hero's head, so its thought cloud floats beside it (`heroCloudLeftOf` in
  [`hd-words.ts`](../../resources/claude-plugins/orca-game/hooks/hd-words.ts)). An older Orca or mod
  that does not know the value drops it with the usual warning and draws classic.

The band above the prompt holds 8 rows at most, so its pet scene (the advisor acting while the lead
is idle, Pet without a spinner) stays classic in either render.

**Cost.** At 120 columns, median of 9 rounds of 800 frames with the cells packed: classic 0.126 ms
walking and 0.103 ms at rest (0.136 and 0.114 before hd landed), hd 0.570 and 0.585 ms. The sky
(gradient, sun or moon, glow) is cached by size, look and quantized daylight; the far and mid
silhouettes by size and scroll step; outlined sprites by costume and frame. The pixel and cell
buffers are reused per size, and a tick that draws the frame a Raster already shows sends nothing
([`frame-gate.ts`](../../resources/claude-plugins/orca-game/hooks/frame-gate.ts)).

`pnpm run capture:orca-game-scenes -- [--out <dir>] [--scene-file <json>] [--phases <all|a,b>]`
([`orca-game-scene-captures.mjs`](../../config/scripts/orca-game-scene-captures.mjs)) renders every
built-in scene, and a scene file, in classic and hd at 06:00, 12:00, 18:00 and 23:00, at 130 and 60 columns to PNGs
through Playwright, with one labelled sheet per scene and phase. A scene file is drawn in every
phase and the built-ins in `build`, unless `--phases` names others. They draw the cells the mod hands its Raster in a browser: not terminal
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
- **3D block.** The optional `scene3d` object is what Orca's WebGL panel draws (ORCA-683), parsed
  apart in [`orchestrator-game-scene-3d.ts`](../../src/shared/orchestrator-game-scene-3d.ts):
  `figure` (`sphere`, `torus`, `helix`, `wave` or `clusters`) and `nodes` (50 to 1600, the cap that
  keeps any project's file inside the memory budget) are required; `links` per node (0 to 4,
  default 3), `spin` (0 to 1, default 0.3), `pulses` (default `true`) and `colors.node`, `.link`,
  `.glow` (default: the scene's own looks) are optional. `orca game scene validate` reports a bad
  block as `scene3d.<key>: <message>` and exits 1, but the game only drops the block with a warning
  and draws the scene as 2D. An Orca build or mod older than the block ignores the key.

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
  Frames are drawn as written, never mirrored: the pet faces right like the hero it follows, the
  advisor left, toward the lead.
  Every frame of one member, `happy` and each gesture body included, is the size of the first.
  Names follow the card rules (a string or one per language, at most 32 characters).
- **A bad member is left out, not the scene.** Orca drops only the invalid `pet` or `advisor` and
  says why in `warnings` (`Scene file <path>: cast.pet.frames: …; drawn without it`, or
  `game scene <id>: …; drawn without it` for a plugin scene), so a typo never takes the scene and
  its hero away. `orca game scene validate` lists those problems like any other. A gesture key the
  game does not know is ignored, so a scene written for a newer game still loads.
- **The pet** walks behind the hero (classic: along its path a few steps back; hd: right behind it,
  ahead of the party) and sits beside it when the hero rests. The
  button reads `♥ Pet <name>` (Spanish `♥ Mimar a <name>`), or `♥ Pet` (`♥ Mimar`) when the pet or
  the scene has no name, in the band and the Panel (`p`). Pet shows its `happy` frame, makes it hop
  and sprinkles the hearts on it; the hero stays on the ground. A scene with no pet hearts the hero,
  Clawd, as before.
- **The advisor** stands at the right edge of the scene, and the hero and its pet walk only the
  stage left of it. It is there only while Jev's `AdvisorState` (`version: 1`) is readable in that
  pane and the game draws other plugins' lines (`absorbing`: mode not `off`, HUD on), or while one
  of Claude's advisor calls plays (below); otherwise there is no advisor and no gap. It acts out
  what changed, never every frame: a new decision, CI state or block notice plays its gesture and
  bubble for about five seconds (a red card about eight), then it goes idle. While the lead is idle and no spinner draws the scene, a gesture brings
  the scene up above the band for as long as it plays (in zen, not for a routine one), as Pet does.
  The first value it sees is where things stand and plays nothing, and a value already acted out
  never plays again, even if a later read brings it back. When
  several changes arrive at once the most important plays: escalation, a stop or CI failure, CI
  success, lowered or raised, unsure or an advisor call's answer, CI running or an advisor call
  opening, then approved; a weaker gesture never cuts one still playing.
- **Jev's gate** answers every Bash command from a settings `PreToolUse` hook (orca-supervisor's
  `gate-bash.ts`), beneath the game's `classic.PreToolUse`, so the game reads its verdict from
  `next(e)`. The `advisor` value carries no verdict. Jev or Clef may have judged it (Clef first in
  Both mode since orca-supervisor 0.13.0, policy commands too since 0.13.4); both are acted out
  alike, and neither touches the advisor's value. A deny whose reason is the gate's own
  (`REFUSED: …` or `Jev advice (not a refusal)` / `Clef advice …`) plays `stopped`; an `allow` plays
  `approved` as a routine decision. The engine drops an allow's reason, so another hook's `allow`
  on Bash plays it too. Another hook's deny, an `ask`, and an obviously safe command the gate
  passes without a verdict play nothing.
- **Claude's advisor calls** come from the session itself, not from Jev: the game hooks
  `session.append` and reads the main conversation's rows. Claude Code keeps an advisor call as
  an assistant row holding a `server_tool_use` block named `advisor`, then, when the advice is
  back (80 s to several minutes later), an assistant row holding an `advisor_tool_result` block
  whose `tool_use_id` matches it. The advisor plays `consulting` from the first row until the
  second, then `advised`; a turn that ends with the call still open (aborted, failed) drops it
  without a reaction. Another server tool, a subagent's call and a session that never calls the
  advisor play nothing, and nothing is replayed from the transcript on load. It is the same
  advisor slot as Jev's, so the two never stand side by side: with Jev drawn, the call plays on
  Jev's advisor and Jev's stronger cues still cut it; without Jev, or while the HUD is off and
  Jev draws its own band, the advisor comes in for the call and leaves after its reaction.

| Jev                                             | Gesture                 | The advisor holds                | Bubble                     |
| ----------------------------------------------- | ----------------------- | -------------------------------- | -------------------------- |
| subagent `why: lowered`                         | `lowered`               | an arrow pointing down           | its model · Jev's verdict  |
| subagent `why: raised`                          | `raised`                | an arrow pointing up             | its model · Jev's verdict  |
| `chosen`, `same`, `explicit`, `inherited`       | `approved`              | a thumbs-up and a whistle's toot | its model · Jev's verdict  |
| `kept-unsure`, `measuring`                      | `unsure`                | a yellow card and a magnifier    | its model · Jev's verdict  |
| a new `block` notice                            | `escalated`             | a red card and a long whistle    | the notice                 |
| a CI run `watching`                             | `ciRunning`             | a stopwatch                      | the run's line             |
| a CI run `success` / `failure`                  | `ciPassed` / `ciFailed` | a green / red flag               | the run's line             |
| the main conversation's model or effort changes | `approved`              | a thumbs-up                      | `model·effort`             |
| Claude's advisor call, while it is open         | `consulting`            | a thought cloud, dots filling in | `let me think...`          |
| the advisor call's result                       | `advised`               | a lit bulb                       | `here is my advice`        |
| the gate denies a Bash command                  | `stopped`               | a stop sign, pushing             | `jev ·` / `clef ·` command |
| the gate allows a Bash command it judged        | `approved`              | a thumbs-up                      | the command                |

Other `why` values (`kept-pointer`, `teammate`, `no-jev`…) play nothing but still reach the Panel.
The bubble keeps only width-1 characters, so an arrow or CJK text in Jev's words is left out. In
`/orca-game:mode zen` the routine `chosen` and `same` decisions and the gate's allows play their
gesture without a bubble. A `REFUSED` deny names no judge, so its bubble is the command alone.

- **The Panel card** names the advisor and Jev's line, wrapped over as many rows as they need,
  then one `★` row for this pane's main conversation on the model it runs now (`★ lead · Opus
5.5·high` in the lead's pane, `★ main conversation · …` elsewhere), then Jev's latest subagent
  decisions with their verdict, colored by gesture; before the first one it lists the agents
  running now. A switch of the main model is the same conversation, so it never adds a second `★`
  row: when Jev's router lowers one turn to Haiku and goes back, the row just follows the value.
  The decisions live in the game's own `$.state` `{ plugin: 'orca-game', key: 'advisor' }`
  (`{ decisions: [...] }`), written when Jev writes its value. The lead's own card draws this
  pane's Jev as a member card draws a member's (`◆ Jev Opus 5.5·high · model pinned`).
- **Each member's Jev, on the lead's Panel.** Pane state does not cross panes, so a member pane's
  mod reports its own Jev on the `orca game state` poll it already runs every 30 s (and at once when
  Jev switches the main model or effort): `ORCA_GAME_ADVISOR` in the CLI's env, JSON
  `{ version: 1, model, effort, pinned: { model, effort } }`, with `pinned` read from
  `ORCA_AGENT_MODEL_PINNED`/`ORCA_AGENT_EFFORT_PINNED`, or `null` once Jev stops after a report. A pane
  where Jev never published sends nothing. The CLI passes it to `game.state` as an optional
  `advisor` param, the host keeps it per pane in memory (a restart refills it within one poll, a
  report not renewed for 3 minutes expires) and puts it on that member's row of its lead's state as
  an optional `advisor` (`{ model, effort, pinned, previous? }`, `previous` being what Jev had it on
  before its latest switch)
  ([`orchestrator-game-member-advisors.ts`](../../src/main/runtime/orchestrator-game-member-advisors.ts)).
  The member card draws `◆ Jev Sonnet 5.5·high · model pinned` (Jev's name, then the pin, dropped
  on a narrow card; what still does not fit wraps, so the model is never cut) and, after a switch,
  `↳ Opus 5.5 → Sonnet 5.5`, naming only what changed; the Fleet heading sums it up (`◆ 2 on Sonnet 5.5, 1 on Opus 5.5`). An env var, not
  a flag, because an older CLI ignores it where an unknown flag could fail the poll and a Windows `.cmd` CLI refuses `"` in its arguments; an
  older host strips the param and an older mod ignores the field, so any mix of versions just shows
  no Jev row. A member gets the mod only where it runs in Agent Teams (today local), so an SSH member
  reports nothing.
- **The model a member was launched on.** A member a coordinator dispatched runs no game mod, so it
  never reports a Jev. Its row then carries an optional `launch` (`{ model, effort }`), read from
  the `effective` launch receipt of the newest dispatch that chose a model or effort for its
  terminal (`worker_dispatches.start_options`), with the CLI id read as a person reads it
  (`claude-opus-5-5` → `Opus 5.5`). The member card draws it as `◇ Opus 5.5·high`, hollow because
  Orca chose it, not Jev; a Jev report wins over it. The lead's advisor card lists every member
  under its `★ lead` row (`◇ ORCA-609 · Opus 5.5·high`, or `◆` for a Jev report), and the Fleet
  heading counts either. The card's rows without a gesture take the terminal's own foreground, not
  the scene's parchment, which a light theme's near-white panel would hide.

## Characters: a look per roster name

A scene's `roster` entry is a plain name, drawn in the phase costumes, or an object that gives that
name a look of its own, so members in the same phase are told apart
([`orchestrator-game-scene-characters.ts`](../../src/shared/orchestrator-game-scene-characters.ts),
[`character-look.ts`](../../resources/claude-plugins/orca-game/hooks/character-look.ts)):

```json
"roster": [
  "Arthur",
  { "name": "Merlin", "variant": { "colors": { "O": "#6f8fe0" }, "accessory": "halo", "accessoryColor": "#fff3a0" } },
  { "name": "Elaine", "costumes": { "working": { "rows": [], "legs": [], "colors": {} } } }
]
```

- **`variant`.** `colors` (glyph → color) is laid over every phase costume's `colors`; a glyph no
  costume draws is refused. `accessory` is one of `crown`, `halo`, `horns`, `antenna`, `bow`,
  `feather`, `cape`, drawn only on empty cells around the head, in `accessoryColor` or its own
  default. A variant needs `colors` or an `accessory`; `accessoryColor` needs an accessory.
- **`costumes`.** A costume for every phase, validated like the scene's own.
- **Validation.** An entry with both looks, or any bad look, drops the whole roster with a
  `roster.N…` warning (names included) and the scene still draws; `orca game scene validate`
  lists every issue.
- **Who is whom.** The mod finds a member's character by the name before the `·` of its display name,
  in any language, case-insensitively and without a ` 2` suffix. A member with no character, or any
  member of a scene without characters, draws exactly as before. The band, the Panel tiles and the
  hd party draw the character; the flat view puts a `■` in its color before the name.
- **On the wire.** `roster` stays names only, so `game.memberName.reserve` and an older mod see what
  they always did. The looks travel in the definition's optional `characters` field
  (`[{ name, variant?, costumes? }]`), which an older mod ignores. An Orca older than this drops a
  file roster with object entries with a warning and keeps the scene.
- **Making them.** `orca game scene new` starts with ten characters. Settings' **Create from**
  writes a scene's characters back as roster entries. The
  [scenes skill](../../skill-guides/orca-game-scenes.md#characters-for-an-existing-scene) adds or
  regenerates them in an existing file in place, and the scene captures draw every roster name as its
  Panel tile (`sheet-roster-scene-file-<phase>.png`).

## Scenes from plugins

An Orca plugin can add more scenes as JSON (`contributes.gameScenes`); `game.state`
sends the valid ones in an optional `extensions.scenes`, each as `{ id, pluginId, definition }`
with `id` namespaced `<publisher>.<id>/<scene id>`, and lists dropped ones in `warnings`. Settings
→ **Scene** offers the built-in scenes plus those of running plugins, and keeps showing an id from
`orca.yaml` that nothing installed serves; the mod draws `quest` for it. Card and teller names may
be per language (`{ "en": …, "es": … }`); the mod shows the `ORCA_GAME_LOCALE` one. The file
format, limits and consent rules are in [Game scenes](./plugin-development.md#game-scenes).

## Arcade game files

A game the arcade offers after a perfect merge is data for one of the game's built-in engines,
never code. The only engine is `runner` (one key to jump), and the built-in runner is
`src/shared/orchestrator-game-arcade-runner.json`. `orca game game validate <file> [--json]`
checks a file with the rules in `src/shared/orchestrator-game-arcade-file.ts`, lists every problem
as `path: message` and exits 1 while any remain.

| Key          | What it sets                                                                     |
| ------------ | -------------------------------------------------------------------------------- |
| `engine`     | `runner`                                                                         |
| `name`       | 1 to 32 characters, a string or `{ "en": …, "es": … }`                           |
| `fps`        | Frame cap, a whole number from 5 to 15                                           |
| `speed`      | `{ start, max, rampPerMinute }` in columns per second; `max` at least `start`    |
| `difficulty` | `{ minGap, maxGap }`, columns of ground between obstacles (8 to 120)             |
| `jump`       | `{ rows, ms }`: height 2 to 8 rows, time in the air 200 to 2000 ms               |
| `obstacles`  | 1 to 8, each `{ "from": "scene" }` or a sprite `{ rows, colors }`, with `weight` |
| `theme`      | Optional. Look colors (`skyTop`, `ground`, …) drawn over the active scene's      |

- `{ "from": "scene" }` is the active scene's ground decoration (`plantKind`), so a custom scene
  restyles the game with no extra work. A scene whose `plantKind` is `none` has none, so the list
  must hold at least one sprite obstacle.
- A sprite is 1 to 6 rows of the same width, 1 to 6 printable ASCII glyphs each; `.` is
  transparent and every other glyph needs a `#rrggbb` (or integer) color.
- `weight` (0.05 to 1, default 1) is how often an obstacle is picked against the others.
- The file is at most 16 KB. Unknown keys are ignored, so a newer file still loads.

### The runner

The mod plays its own copy of the built-in runner
([`arcade-runner-data.ts`](../../resources/claude-plugins/orca-game/hooks/arcade-runner-data.ts)); a spec
holds it equal to the JSON Orca validates. A run is drawn as an hd band of the active scene, 12 rows
tall: its sky, clouds, far range, hills and ground behind, the scene's working costume as the hero and
its own decoration (`plantKind`) as obstacles, cut to at most 4 pixels by 5 columns and outlined like a
character so a timed jump clears one even at `speed.max`. The scene's scattered plants and pond are left
out of the backdrop, since anything on the ground line reads as something to jump.

- One key, `j`: it starts a run, jumps, resumes a paused run and starts again after a crash. `q` (or
  Esc) closes the pane.
- The run ticks on its own timer at `fps`, never above 15, and only while it moves: none before the
  first press, none once the pane is hidden or loses the keyboard (it pauses), none after a crash.
- At 160 columns a frame costs about 1 ms, so a run in play takes under 2% of a core.

`/orca-game:demo arcade` (or `/quest demo arcade`) opens a practice run in a pane of its own: it
earns no points or XP, writes nothing to Orca or the store, adds no setting, and closing the pane
drops the run.

A lead pane (`role` not `member`, rewards on) offers one run when a member's review turns
`perfectMerge: true` between two polls
([`arcade-unlock.ts`](../../resources/claude-plugins/orca-game/hooks/arcade-unlock.ts)). The offer
is keyed by the perfect-merge reward's id and kept under `arcade-offers` in `$.store`, so a merge
seen again after a replay or a reload never offers twice. `/orca-game:demo offer` (or
`/quest demo offer`) plays the same offer
([`arcade-offer.ts`](../../resources/claude-plugins/orca-game/hooks/arcade-offer.ts)), keeping
nothing:

- The scene celebrates (the merge float and the level-up stars, drawn in the band while idle) and
  the arcade pane opens asking for the keyboard, so `j` and `n` reach the pane and never the
  prompt. Claude Code grants that only over an empty composer with no dialog or survey up, so text
  the user is typing stays theirs; then the line names `ctrl+x tab, then j`, which is true there.
- A line under the frame counts down 15 seconds. `j` (or a click on Play) starts the run; `n`, Esc
  or the end of the countdown closes the pane and drops the offer.
- While a teammate waits on the user (the band's "Needs you"), or a member's own question waits on
  its lead, the countdown stands still, a run in play holds with no frames, and an offer opened then
  leaves the keyboard to the prompt for the answer; both go on by themselves once it is answered.
- Points a real offer's run earns stay apart from member XP; a demo offer writes none.

## Other plugins in a game pane

Other Claude Code plugins keep running in a team pane; while the game is drawn (mode `on`,
`zen` or `flat` with the band on) the mod draws what they show in the scene's style instead of
letting each one paint its own
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
  on every change: the env, Orca's live config and `/orca-game:mode`. Jev reads it, so a pane where the game
  stops drawing (`/orca-game:mode off`, the HUD turned off in Settings) shows Jev's own line again, and one
  where it starts never shows Jev twice. `/orca-game:mode off` keeps the band (the HUD is its own switch) and
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
