# Worktrees

A worktree is a separate checkout of your repository on its own branch, created with
`git worktree add`. Orca Lab gives each task its own worktree, so agents can work in parallel
without stashing or switching branches in your main checkout.

## Create a worktree

- Press `Mod+N` (or `Mod+Shift+N`) to open **Create worktree**. `Mod` is Cmd on macOS and Ctrl on Windows and Linux.
- The dialog asks for a project and a name. It also has an agent to launch, an optional note, and advanced options such as sparse checkout and reusing an existing branch.
- New worktrees are created under `~/orca/workspaces` by default.

## Switch between worktrees

- `Mod+1` to `Mod+9` select a worktree by position in the sidebar.
- `Mod+Shift+Up` and `Mod+Shift+Down` move to the previous and next worktree.
- `Mod+J` opens the switch palette (see [Quick open](quick-open.md)).

## Manage worktrees

Right-click a worktree in the sidebar to:

- copy its path, pin or unpin it, and mark it read or unread
- move it to a status
- set or open a parent worktree
- sleep it, with or without its descendants
- assign a Claude account
- delete it, or delete it with its descendants

The primary worktree of a project cannot be deleted. Remove the project instead.

## Run several agents at once

Each worktree can host its own agent terminals, so you can give one task to one agent and another
task to a second agent, then compare the results. Agents on the same project can also coordinate
through the [CLI](../cli/overview.md).
