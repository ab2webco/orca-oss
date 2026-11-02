<h1 align="center">
  <img src="resources/build/icon.png" alt="Orca Lab" width="64" valign="middle" /> Orca Lab
</h1>

<p align="center">
  <a href="https://github.com/ab2webco/orca-oss/releases/latest"><img src="https://img.shields.io/github/v/release/ab2webco/orca-oss?include_prereleases&amp;label=release&amp;color=08C" alt="Latest release" /></a>
  <a href="https://github.com/ab2webco/orca-oss/stargazers"><img src="https://img.shields.io/github/stars/ab2webco/orca-oss?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/license-MIT-08C?style=flat" alt="License: MIT" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
  <img src="https://img.shields.io/badge/iOS%20%7C%20Android-4493F8?style=flat-square" alt="Mobile companion: iOS and Android" />
</p>

<p align="center">
  <sub>English · <a href="docs/readme/README.es.md">Español</a></sub>
</p>

<p align="center">
  <strong>Run a team of coding agents, each in its own worktree, on every machine you own, and see who needs you.</strong><br/>
  Orca Lab is Ab2Web's build of <a href="https://github.com/stablyai/orca">Orca</a>: a desktop IDE for agents, a phone companion, and a lead agent that runs one member per ticket across your machines.
</p>

<h3 align="center"><a href="https://github.com/ab2webco/orca-oss/releases/latest"><ins>Download Orca Lab</ins></a></h3>

<p align="center">
  <img src="docs/assets/readme/multi-host-fleet.gif" alt="The lead's Panel: members on this machine and on two paired hosts, each host with its running/cap, cores, free memory and load; a remote member's CI turns green and another remote PR merges, paying XP and a level-up" width="960" />
</p>

<p align="center">
  <a href="#how-it-fits-together">How it fits together</a> ·
  <a href="#desktop">Desktop</a> ·
  <a href="#mobile">Mobile</a> ·
  <a href="#orca-game-a-team-lead-with-engineering-discipline">Orca Game</a> ·
  <a href="#run-members-on-every-machine-you-own">Multi-host</a> ·
  <a href="#install">Install</a>
</p>

## How it fits together

```mermaid
flowchart TB
  phone["Phone · iOS / Android"]
  plane[("Plane · tickets")]
  subgraph main["Your main machine"]
    desk["Orca Lab desktop<br/>agent grid · terminals · Panel"]
    lead["Lead agent · Orca Game"]
    m1["Members<br/>one worktree per ticket"]
  end
  subgraph hosts["Paired hosts · Tailscale / LAN"]
    h1["Old laptop<br/>its own accounts"]
    h2["Linux box<br/>orca serve"]
  end
  gh[("GitHub · PRs · CI · merge queue")]

  phone <-- "encrypted relay" --> desk
  plane <-- "tickets, status" --> lead
  desk --- lead
  lead --> m1
  lead -- "game launch --on" --> hosts
  m1 -- "branch, PR" --> gh
  hosts -- "branch, PR" --> gh
```

Plane holds the work, GitHub holds the code, and the lead turns one into the other through members that each own a ticket, a worktree and a branch, on this machine or a paired one. CI going green and PRs merging come back to the lead as XP. You watch and answer from the desktop or from your phone.

## Desktop

### See every agent at once

The agent grid puts every live agent of every project on one screen, grouped by what it needs from you: **Needs You**, **Working**, **Done** and **Idle**. Each cell is the agent's own terminal.

<p align="center">
  <img src="docs/assets/readme/agent-grid.gif" alt="The agent grid of Orca Lab: four agents grouped as Needs You, Working and Done, filtered by bucket" width="960" />
</p>

- **One worktree per agent.** Every task gets its own git worktree, so agents never edit the same checkout; folders work as workspaces too. [Worktrees →](docs/user/model/worktrees.md)
- **Terminals that outlive the window.** Tabs and split panes run in a background daemon, so a restart reconnects them with their recent output. [Terminal →](docs/user/terminal.md)
- **SSH worktrees and headless hosts.** Run worktrees on a remote machine over SSH, or run the whole runtime without a window with `orca serve`. [SSH →](docs/user/ssh.md) · [Headless Linux →](docs/reference/headless-linux-server.md)
- **Quick open, file explorer and viewers** for code, images and documents. [Quick open →](docs/user/model/quick-open.md) · [Files →](docs/user/editing/file-explorer.md) · [Viewers →](docs/user/editing/viewers.md)

### Switch Claude and Codex accounts without losing the session

Add several Claude and Codex accounts and pick the active one in Settings → AI Provider Accounts, or switch a running terminal with `orca account switch`: Claude relaunches in the same terminal and resumes the conversation. A worktree can be pinned to its own account, and usage and quota resets show next to each agent. [Usage tracking →](docs/user/agents/usage-tracking.md)

<p align="center">
  <img src="docs/assets/readme/claude-accounts-switch.gif" alt="Settings → AI Provider Accounts: three Claude accounts, the Active badge moving from one to the next with a confirmation toast" width="960" />
</p>

### Work from your Plane board

Connect a Plane workspace and its projects become a task source: a board with one column per state, or a list grouped by state, with priority and assignee on every work item. Agents read and move the same tickets with `orca plane`. Linear works as a task source as well. [Plane and Linear →](docs/user/review/linear.md)

<p align="center">
  <img src="docs/assets/readme/plane-board.gif" alt="The Tasks page on a Plane project: Todo, In Progress, In Review and Done as board columns, then the same work items as a list" width="960" />
</p>

### Review what agents built

- **Annotate an AI diff.** Leave notes in the diff gutter and send them straight to the agent's terminal. [Annotate →](docs/user/review/annotate-ai-diff.md)
- **Built-in browser with design mode.** Preview the page an agent changed, pick an element, and send a question or change request with its selector, styles and HTML. [Design mode →](docs/user/browser/design-mode.md)

<p align="center">
  <img src="docs/assets/readme/diff-note.gif" alt="A diff an agent wrote: the + button in the gutter opens Add note for the AI, the note is typed and saved under line 2, and the toolbar counts 1 AI note to send" width="960" />
</p>

<p align="center">
  <img src="docs/assets/readme/design-mode.gif" alt="Orca's browser on a page under work: Annotate page element highlights the headline with its selector, a note for the agent is typed, and the annotation joins the list to send" width="960" />
</p>

### Extend it with plugins

A plugin is a folder with an `orca-plugin.json`. Nothing runs until you review what it asks for; then its panel, settings and worker go live, sandboxed. [Orca Sonar](docs/reference/orca-sonar.md) is one: `orca sonar find` and `orca sonar symbol` give agents an index of the repo instead of grep. The [worklog example](examples/plugins/worklog) exercises the whole API. [Plugin development →](docs/reference/plugin-development.md)

<p align="center">
  <img src="docs/assets/readme/worklog-plugin.gif" alt="Settings → Plugins: the Worklog plugin needs review, the consent dialog lists its capabilities and its scheduled automation, then its panel shows recent entries and settings" width="960" />
</p>

### Safety nets and automation

- **Crash reports** with the process that died, memory by process type and GPU/WebGL state, from a dialog you can review before sending.
- **Low-memory warning** that lists agent terminals first and says what opened it.
- **Automations** that run a scheduled prompt or command, on the Claude or Codex account the automation picks.
- **The `orca` CLI** drives all of it, so agents can too: worktrees, terminals, accounts, Plane, the game and more. [CLI →](docs/user/cli/overview.md)

## Mobile

The Orca Lab app pairs with your desktop and puts your agents in your pocket. Pair once from Desktop → Settings → Mobile by scanning a QR code; the phone then reaches the desktop directly or through an end-to-end encrypted relay. [Mobile app →](mobile/README.md)

- **Live terminals.** Watch any agent's terminal stream and type into it.
- **Owner-question Inbox.** When a lead needs a decision only you can make, the question lands in the phone's Inbox with a notification. Answer it there, and the answer goes back to the lead.
- **Notification tap routing.** A tap opens the right host and screen; a lead's question opens the lead's terminal with the Team drawer.
- **Team drawer over the lead's terminal.** Open questions, a card per member with its ticket, state, PR and CI, and the team's metrics: merges per day and median lead time.
- **Plane board and plugin panels** from the phone, and a button that asks the desktop to install its pending update.

```mermaid
sequenceDiagram
  participant M as Member (any host)
  participant L as Lead
  participant D as Orca Lab desktop
  participant P as Your phone
  M->>L: question or decision gate
  L->>L: answers what it can on its own
  L->>D: game ask-owner (only what you must decide)
  D-->>P: notification
  P->>D: tap → Team drawer, answer
  D->>L: your answer
  L->>M: reply, recorded on the ticket
```

Builds: iOS ships through TestFlight; Android APKs are attached to the [`mobile-android-v*` releases](https://github.com/ab2webco/orca-oss/releases?q=mobile-android).

## Orca Game: a team lead with engineering discipline

Orca Game turns a Claude Code session into the **lead** of a team. The lead does not write the code itself: it launches one **member** per ticket, each in its own worktree and branch, waits for their reports, answers their questions, and asks you only what only you can decide.

It looks like a game, a pixel-art party under the lead's prompt with XP and level-ups, because watching ten agents in ten terminals is hard. The rules underneath are the ones a good engineering team already keeps.

The idea of running a Claude Code team as a game came from [Jucer Orozco](https://github.com/Jucerweb).

<p align="center">
  <img src="docs/assets/readme/game-band-panel.gif" alt="The game band under a Claude Code lead: three members, one waiting on you; the Panel lists each member's ticket, branch, PR and CI; a merged PR and green CI award XP and a level-up" width="960" />
</p>

**What keeps it serious**

- **XP only from verified signals.** A member earns nothing for saying it is done. XP comes from CI turning green, the ticket reaching review or Done, and the PR merging. [The lead's XP →](docs/reference/orchestrator-game.md#the-leads-xp)

  | Signal                  | XP  |
  | ----------------------- | --- |
  | Member claims a ticket  | 10  |
  | Its PR's CI turns green | 20  |
  | Ticket moves to review  | 50  |
  | Ticket reaches Done     | 70  |
  | PR merges               | 100 |
  | Merged PR is perfect    | 100 |

- **One agent per ticket, the tracker is the source of truth.** Members are launched from the Plane (or other tracker) To Do, `game wave` fills the free slots in board order, and a ticket a member already holds is skipped.
- **Your rules, not just Orca's.** Orca's standing rules come first; a project appends its own in `orca.yaml` (`orchestrator.rules`): strict TDD, conventional commits, merging only through the merge queue, whatever your team enforces.
- **Typed reports.** A member finishes with a `worker_done` envelope that states each claim it verified and how: live, unit tests only, or not at all. The runtime rejects a malformed report, and a success cannot rest on an unverified claim.
- **Finish before starting.** The lead drives each member to a merge before it launches another ticket, then removes the merged worktree and branch, so half-done work does not pile up.
- **Questions go somewhere real.** Members ask the lead, or stop on a decision gate; the lead answers what it can and records the answer on the ticket. What only you can decide (releases, spending, hard-to-reverse actions, product direction) becomes an owner question with options, kept in an Inbox on desktop and phone, never buried in chat.
- **The Panel shows the truth.** One card per member with its ticket, branch, PR, CI and state, plus your open PRs, the To Do, and metrics: merges per day, lead time, and which accounts are working.
- **Recovery is built in.** `game resume-members` brings back members a restart paused; `game adopt` takes an agent the fleet found running into the team, `game drop` lets one go without stopping it; `game lead --fresh` rotates to a new lead when the old conversation is too long.

A wave fills the free slots from the To Do, one member per ticket; green CI and a merge pay XP:

<p align="center">
  <img src="docs/assets/readme/lead-wave.gif" alt="The lead's Panel with a To Do of 4; after a wave LUM-14 and LUM-15 are launched as members (+10 XP each) and the To Do drops to 2; then LUM-12's CI turns green and its PR merges, paying XP and a level-up" width="960" />
</p>

A question only you can answer lands in Orca's Inbox, and your answer goes back to the lead:

<p align="center">
  <img src="docs/assets/readme/owner-inbox.gif" alt="Orca Lab desktop: the Inbox entry shows 2; the Inbox lists the lead's two questions with option buttons; one is answered with Ship in 2.3 and the count drops to 1" width="960" />
</p>

The Panel also keeps your open PRs and the team's numbers:

<p align="center">
  <img src="docs/assets/readme/panel-metrics.gif" alt="The lead's Panel: My PRs with CI green, CI running and changes requested; then the Metrics widget with merges per day over 14 days, median lead time and each Claude account's session and weekly use" width="960" />
</p>

Settings → Agents picks how it looks, and what it costs your machine: **Off**, **Flat** (plain text), **Zen**, **2D classic** or **2D hd**. Scenes are themeable. [Orca Game reference →](docs/reference/orchestrator-game.md)

<p align="center">
  <img src="docs/assets/readme/game-view-switcher.gif" alt="Settings → Agents → Default view: the five views, then Flat and Off turning the scene preview off" width="960" />
</p>

## Run members on every machine you own

A member does not have to run on the machine you are sitting at. Every Orca you pair becomes a host the lead can place members on, with `orca game launch <ticket> --on <host>`.

```mermaid
flowchart TB
  lead["Lead on your laptop<br/>cap = sum of every host"]
  subgraph local["local · 3/5 · 10 cores · 12 GB free"]
    a["Member · ORCA-101"]
    b["Member · ORCA-102"]
  end
  subgraph old["old-imac · 4/8 · 4 cores · 40 GB free"]
    c["Member · ORCA-103<br/>its own Claude accounts"]
  end
  subgraph box["build-box · 2/12 · 32 cores · busy"]
    d["Member · ORCA-104"]
  end
  lead --> a & b
  lead -- "--on old-imac" --> c
  lead -- "--on build-box" --> d
```

- **Pairing.** Any machine running Orca Lab, the desktop app or `orca serve` on a headless Linux box, prints a pairing link; `orca environment add` saves it on the lead's machine. A Tailscale address keeps it private. [Headless server →](docs/reference/headless-linux-server.md)
- **Caps that add up.** Each host's member cap comes from its own memory and cores, and the lead's cap is the sum over every reachable host. A launch past a host's cap is refused and names a host with room.
- **Every host in plain sight.** `game fleet`, `game state` and the Panel show each host's members against its cap, cores, free memory and load, flagged `low memory` or `busy`.
- **Each host uses its own accounts.** A remote member picks a Claude or Codex account from that host's roster, so adding a machine adds quota, not only CPU.
- **One fleet, both ways.** Remote members appear in the lead's Panel with their ticket, PR and CI, report back with the same typed messages, and open their terminal from the Panel through the paired host.
- **Survives restarts.** When a host restarts, `game resume-members` wakes the members it put to sleep, and the Panel card offers Resume and Reconnect.

**Why it matters:** the laptop you stopped using can run two members tonight. A strong workstation can take the heavy tickets and shorten the queue. And your main machine stays responsive while the work runs somewhere else. [Fleet and hosts →](docs/reference/orchestrator-game.md#the-project-lead-orchestratorgameorchestrator)

## Under the hood

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/architecture-dark.svg" />
  <img src="docs/assets/readme/architecture-light.svg" alt="Orca Lab architecture: the renderer talks to the Electron main runtime over IPC; a detached terminal daemon owns the agent PTYs; agents report status to a local hook server; the orca CLI and the mobile app reach the runtime over RPC; plugins run in a sandboxed panel and a separate worker; remote worktrees run relay.js over SSH; the Plane client calls Plane's REST API" width="960" />
</picture>

The window is an Electron main process plus a React renderer. Terminals live in a separate daemon that outlives the app process, agents report their state to a hook server on `127.0.0.1`, and the `orca` CLI and the phone reach the same runtime over RPC. Blue boxes exist only in Orca Lab.

<sub>People, accounts, projects and tickets in the recordings are invented demo data on example.com. The scenes were recorded from the real build by E2E specs under `tests/e2e/*-showcase.spec.ts`.</sub>

## Install

- **[Download the latest release](https://github.com/ab2webco/orca-oss/releases/latest)**
- Or pick a build: [macOS Apple Silicon](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-arm64.dmg) · [macOS Intel](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-x64.dmg) · [Windows (.exe)](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-windows-setup.exe) · [Linux AppImage](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-linux.AppImage)
- Running `orca serve` on a headless Linux server? See the [headless Linux server guide](docs/reference/headless-linux-server.md).

## Docs

User guides live in [`docs/user`](docs/user/README.md): [CLI](docs/user/cli/overview.md), [SSH worktrees](docs/user/ssh.md), [usage tracking](docs/user/agents/usage-tracking.md), [supported agents](docs/user/agents/supported.md) and [telemetry](docs/user/telemetry.md). The [release notes](https://github.com/ab2webco/orca-oss/releases) list every change.

## Developing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). Rendered UI checks run through the E2E harness: [`docs/reference/rendered-ui-checks.md`](docs/reference/rendered-ui-checks.md).

## License

Orca Lab is free and open source under the [MIT License](LICENSE). It builds on [Orca](https://github.com/stablyai/orca) by stablyai.
