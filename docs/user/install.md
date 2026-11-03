# Install

Orca Lab ships from the [GitHub releases page](https://github.com/ab2webco/orca-oss/releases/latest).
Every release carries a build for each desktop platform and the update manifests the app uses to
update itself in place.

## Desktop builds

| Platform              | File                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| macOS (Apple Silicon) | [`orca-macos-arm64.dmg`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-arm64.dmg) |
| macOS (Intel)         | [`orca-macos-x64.dmg`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-macos-x64.dmg)     |
| Windows               | [`orca-windows-setup.exe`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-windows-setup.exe) |
| Linux x64             | [`orca-linux.AppImage`](https://github.com/ab2webco/orca-oss/releases/latest/download/orca-linux.AppImage), or the `.deb` on the release page |

The Linux build targets stock Ubuntu 20.04 and newer (glibc 2.31). On Windows, worktrees can live
inside WSL, and the CLI has its own WSL shell command.

## The `orca` command

Open **Settings > General > Orca Lab CLI** and choose **Register** under **Shell command**. Agents
and scripts then drive Orca Lab from any terminal. See the [CLI guide](cli/overview.md).

## Without a window

To run Orca Lab on a server and pair it as a host for remote members, run `orca serve` on a
headless Linux machine. The [headless Linux server guide](../reference/headless-linux-server.md)
covers the service unit, pairing and upgrades.

## Phone

The companion app pairs with the desktop from **Settings > Mobile**. See [Mobile](mobile.md).
