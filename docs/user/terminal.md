# Terminal

Each worktree has terminal tabs. A tab can be split into panes, and each pane runs its own shell
or agent.

## Tabs and panes

- `Mod+T` opens a new terminal tab.
- `Mod+Alt+T` opens a new agent tab with the default agent on macOS.
- On macOS, `Cmd+D` splits the active pane to the right and `Cmd+Shift+D` splits it down. On Windows and Linux, the split keys are `Ctrl+Shift+D` (right) and `Alt+Shift+D` (down).
- `Mod+]` and `Mod+[` move focus to the next and previous pane.
- `Mod+Shift+Enter` expands or collapses the active pane.
- `Mod+W` closes the active pane.
- `Mod+F` searches the active pane. `Mod+K` clears it.

## Across restarts

Terminals run in a background process. When you reopen Orca Lab, the app reconnects to the
terminals that are still running and restores their recent output.

Terminals on an SSH host keep running for a grace period after a disconnect. See [SSH](ssh.md).

Use **Restart the terminal daemon** or **Kill all terminal sessions** in Settings only when a
terminal is stuck. Killing sessions ends the running processes.
