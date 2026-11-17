@echo off
rem Why: Orca's hook trust grant runs codex app-server; answer like an old codex instead of starting the stub TUI (ORCA-1248).
if "%~1"=="app-server" (
  echo error: unrecognized subcommand 'app-server' 1>&2
  exit /b 2
)
call "%~dp0golden-stub-agent.cmd" %*
