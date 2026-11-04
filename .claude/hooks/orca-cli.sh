# Sourced by the bash hooks: shadows `orca` with the CLI that orca_cli.py resolves, so no call site
# can reach the GNOME screen reader. With no CLI, `orca` fails like a command that is not there.
orca_cli_path=$(python3 "$(dirname "${BASH_SOURCE[0]}")/orca_cli.py" 2>/dev/null) || orca_cli_path=""

orca() {
  [ -n "$orca_cli_path" ] || return 127
  "$orca_cli_path" "$@"
}
