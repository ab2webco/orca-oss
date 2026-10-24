<h1 align="center">
  <img src="resources/build/icon.png" alt="Orca Lab" width="64" valign="middle" /> Orca Lab
</h1>

<p align="center">
  <a href="https://github.com/ab2webco/orca-oss/releases/latest"><img src="https://img.shields.io/github/v/release/ab2webco/orca-oss?include_prereleases&amp;label=release&amp;color=08C" alt="Latest release" /></a>
  <a href="https://github.com/ab2webco/orca-oss/stargazers"><img src="https://img.shields.io/github/stars/ab2webco/orca-oss?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/license-MIT-08C?style=flat" alt="License: MIT" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
</p>

<p align="center">
  <sub>English · <a href="docs/readme/README.es.md">Español</a></sub>
</p>

<p align="center">
  <strong>Run a team of coding agents, each in its own worktree, and see who needs you.</strong><br/>
  Orca Lab is Ab2Web's build of <a href="https://github.com/stablyai/orca">Orca</a>, with per-worktree accounts, an agent-team game, Plane tasks and a mobile companion.
</p>

<h3 align="center"><a href="https://github.com/ab2webco/orca-oss/releases/latest"><ins>Download Orca Lab</ins></a></h3>

<p align="center">
  <img src="docs/assets/readme/agent-grid.gif" alt="The agent grid of Orca Lab: four agents grouped as Needs You, Working and Done, filtered by bucket" width="960" />
</p>

## See every agent at once

The agent grid puts every live agent of every project on one screen, grouped by what it needs from you: **Needs You**, **Working**, **Done** and **Idle**. Press a bucket to keep only its agents, press it again to see all of them. Each cell shows the agent's own terminal.

[Worktrees →](docs/user/model/worktrees.md) · [Terminal →](docs/user/terminal.md)

## Play the team, or switch the game off

Claude Agent Teams panes can draw the fleet as a small game: a lead, members as characters, XP for verified work. Settings → Agents picks how it looks, and what it costs your machine, from five views: **Off**, **Flat** (plain text, no scene), **Zen**, **2D classic** and **2D hd**. Each project can override the default, and one pane can switch with `/orca-game:view`.

<p align="center">
  <img src="docs/assets/readme/game-view-switcher.gif" alt="Settings → Agents → Default view: the five views, then Flat and Off turning the scene preview off" width="960" />
</p>

## How it fits together

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/architecture-dark.svg" />
  <img src="docs/assets/readme/architecture-light.svg" alt="Orca Lab architecture: the renderer talks to the Electron main runtime over IPC; a detached terminal daemon owns the agent PTYs; agents report status to a local hook server; the orca CLI and the mobile app reach the runtime over RPC; plugins run in a sandboxed panel and a separate worker; remote worktrees run relay.js over SSH; the Plane client calls Plane's REST API" width="960" />
</picture>

The window is an Electron main process plus a React renderer. Terminals live in a separate daemon that outlives the app process, agents report their state to a hook server on `127.0.0.1`, and the `orca` CLI and the phone reach the same runtime over RPC. Blue boxes exist only in Orca Lab.

## What Orca Lab adds

Everything below is in the product history since the fork from Orca (1,273 commits, 249 of them features). The two scenes above were recorded from the real build; the rest is listed from the commit log and release notes, and has no recording yet.

- **Accounts per worktree.** Pin a Claude or Codex account to a worktree, fail over when quota runs out, switch a running terminal with `orca account switch`, and use custom endpoints.
- **Sturdier orchestration.** Typed `worker_done` reports, a dispatch watchdog, restart recovery, and paused members that resume where they stopped.
- **Plane as a task source.** Boards, columns, worktree linking, comments and cycles from the app and from `orca plane`.
- **Mobile companion.** Pair a phone, browse the Plane board, open plugin panels, and request a desktop update from the phone.
- **Plugins.** Panels, skills, settings and consent for plugins, with a worklog example in [`examples/plugins`](examples/plugins).
- **Agent status line and usage.** Quota reset, context trend and per-project usage next to each agent.
- **Automations with an account.** Run scheduled prompts on the Claude or Codex account an automation chooses.
- **Safety nets.** A low-memory warning that lists agent terminals first and says what opened it, and refusal to remove a game member's worktree while it holds unpushed commits.
- **Orca CLI.** `orca events`, `orca game metrics`, `orca plane` and more, so agents can drive the app.

The [release notes](https://github.com/ab2webco/orca-oss/releases) are the full feature list.

## Install

- **[Download the latest release](https://github.com/ab2webco/orca-oss/releases/latest)**
- Or pick a build: [macOS Apple Silicon](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-arm64.dmg) · [macOS Intel](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-x64.dmg) · [Windows (.exe)](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-windows-setup.exe) · [Linux AppImage](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-linux.AppImage)
- Running `orca serve` on a headless Linux server? See the [headless Linux server guide](docs/reference/headless-linux-server.md).

## Docs

User guides live in [`docs/user`](docs/user/README.md): [CLI](docs/user/cli/overview.md), [SSH worktrees](docs/user/ssh.md), [usage tracking](docs/user/agents/usage-tracking.md), [supported agents](docs/user/agents/supported.md) and [telemetry](docs/user/telemetry.md).

## Developing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). Rendered UI checks run through the E2E harness: [`docs/reference/rendered-ui-checks.md`](docs/reference/rendered-ui-checks.md).

## License

Orca Lab is free and open source under the [MIT License](LICENSE). It builds on [Orca](https://github.com/stablyai/orca) by stablyai.
