# CLI

The `orca` command controls a running Orca Lab from any terminal. Scripts and agents use it to
create worktrees, drive terminals, coordinate agents and share artifacts.

## Install

Open **Settings > General > Orca Lab CLI** and choose **Register** under **Shell command**.

- On macOS, Orca Lab links `orca` into `/usr/local/bin`, or into `~/.local/bin` when that folder
  exists and `/usr/local/bin` does not.
- On Windows, Orca Lab adds the command folder to your user PATH.
- On Linux AppImage builds, Orca Lab installs a wrapper script.
- WSL has its own **WSL shell command** entry.

Use **Remove** in the same place to undo the registration.

## Main command groups

- `orca open` and `orca status`: start Orca Lab and check that it is running.
- `orca worktree`: create, list, show, set and remove worktrees.
- `orca terminal`: create, list, read, send text to, wait on, split and close terminals.
- `orca orchestration`: send messages, ask questions and dispatch tasks between agents.
- `orca account`: list accounts and their cached quota, add an account, and switch Claude accounts.
- `orca artifacts`: share, update, list, delete and unshare HTML or Markdown artifacts.
- `orca plane` and `orca linear`: read and update linked tasks.

Run `orca --help` or `orca <group> --help` for the full list of subcommands and options.

## How it connects

The CLI reads a runtime file in Orca Lab's data folder and talks to the running app over a local
socket. It needs Orca Lab to be running, except for `orca open`.
