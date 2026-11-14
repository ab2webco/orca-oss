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

## Tabs on a narrow window

Tabs shrink as the window narrows. Below about 120 pixels of tab bar, as on a phone-width pane,
each tab shows only its icon, hovering a tab swaps the icon for its close button, and a **+N**
button counts the other tabs. Click it to list them by name and pick one.

## Windows and WSL

**Settings > Terminal > Windows Shell** sets the **Default Shell** for new panes (PowerShell,
Command Prompt, Git Bash when it is installed) and the **Default project runtime**: **Windows** or
**WSL** with a distro. Projects inherit that runtime unless a project overrides it.

- Terminals that belong to no project, such as a folder workspace or the floating terminal, follow
  the same default: with **WSL** chosen they open in that distro. A shell you pick for one tab
  still wins.
- A distro you install while Orca Lab is open shows up in the distro list without a restart:
  Settings checks again once its list is a minute old.

## Across restarts

Terminals run in a background process. When you reopen Orca Lab, the app reconnects to the
terminals that are still running and restores their recent output.

Terminals on an SSH host keep running for a grace period after a disconnect. See [SSH](ssh.md).

Use **Restart the terminal daemon** or **Kill all terminal sessions** in Settings only when a
terminal is stuck. Killing sessions ends the running processes.
