import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveWindowsExecutable } from '../attribution/terminal-attribution'
import { resolvePathEnvKey } from './windows-path-segment-merge'

const ROOT_DIR = 'orca-gh-pr-cap'

// Why: a WSL pane has no bare orca, only the orca-ide its ORCA_CLI_COMMAND names (ORCA-1388).
const ORCA_CLI_IN_SH = '"${ORCA_CLI_COMMAND:-orca}"'

// Why sh, not bash: every other gh call pays this script's start, so it stays minimal and
// only `gh pr create` runs Orca's CLI (ORCA-1301).
export const POSIX_GH_PR_CAP_WRAPPER = String.raw`#!/bin/sh
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
clean=
set -f
old_ifs=$IFS
IFS=:
for entry in $PATH; do
  [ "$entry" = "$self_dir" ] && continue
  if [ -z "$clean" ]; then clean=$entry; else clean="$clean:$entry"; fi
done
IFS=$old_ifs
set +f
real_gh=$(PATH=$clean command -v gh || true)
if [ -z "$real_gh" ]; then
  echo "Orca's gh wrapper could not find gh on PATH." >&2
  exit 127
fi
is_pr_create() {
  while [ $# -gt 0 ]; do
    case $1 in
      -R|--repo) [ $# -ge 2 ] || return 1; shift 2 ;;
      -R*|--repo=*) shift ;;
      pr) [ $# -ge 2 ] && [ "$2" = create ]; return ;;
      *) return 1 ;;
    esac
  done
  return 1
}
if is_pr_create "$@"; then
  orca_cli=${ORCA_CLI_IN_SH}
  # Why: a user rc can put /usr/bin, and GNOME's screen reader, before Orca's CLI shim (ORCA-1371).
  case $ORCA_GAME_CLI in /*) [ -x "$ORCA_GAME_CLI" ] && orca_cli=$ORCA_GAME_CLI ;; esac
  "$orca_cli" game pr-cap-check
  code=$?
  [ $code -eq 3 ] && exit 1
  if [ $code -ne 0 ] && [ $code -ne 4 ]; then
    echo "Orca did not check this project's open-PR cap (orca exited $code), so gh pr create runs. The lead's game watch alerts once open PRs pass the cap." >&2
  fi
fi
PATH=$clean exec "$real_gh" "$@"
`

// Why one .cmd: PowerShell runs it through PATHEXT too, so cmd and PowerShell panes share it.
export const WIN32_GH_PR_CAP_WRAPPER = String.raw`@echo off
setlocal
if not defined ORCA_PR_CAP_NEXT_GH goto missing
set "orca_pr="
if /I "%~1"=="pr" if /I "%~2"=="create" set orca_pr=1
if /I "%~1"=="-R" if /I "%~3"=="pr" if /I "%~4"=="create" set orca_pr=1
if /I "%~1"=="--repo" if /I "%~3"=="pr" if /I "%~4"=="create" set orca_pr=1
if not defined orca_pr goto run
call orca game pr-cap-check
set orca_code=%ERRORLEVEL%
if "%orca_code%"=="3" exit /b 1
if "%orca_code%"=="0" goto run
if "%orca_code%"=="4" goto run
echo Orca did not check this project's open-PR cap (orca exited %orca_code%), so gh pr create runs. The lead's game watch alerts once open PRs pass the cap. 1>&2
:run
"%ORCA_PR_CAP_NEXT_GH%" %*
exit /b %ERRORLEVEL%
:missing
echo Orca's gh wrapper could not find gh on PATH. 1>&2
exit /b 127
`

/** Runtime marks every game member's pane, whatever its agent, since only Claude's carries ORCA_GAME_ROLE. */
export const GH_PR_CAP_MEMBER_ENV = 'ORCA_GH_PR_CAP_MEMBER'

const isGameMemberPane = (env: Record<string, string>): boolean =>
  env.ORCA_GAME_ROLE === 'member' || env[GH_PR_CAP_MEMBER_ENV] === '1'

const written = new Set<string>()

function ensureGhPrCapShims(userDataPath: string): { posixDir: string; win32Dir: string } {
  const posixDir = join(userDataPath, ROOT_DIR, 'posix')
  const win32Dir = join(userDataPath, ROOT_DIR, 'win32')
  if (!written.has(userDataPath)) {
    mkdirSync(posixDir, { recursive: true })
    mkdirSync(win32Dir, { recursive: true })
    writeFileSync(join(posixDir, 'gh'), POSIX_GH_PR_CAP_WRAPPER, 'utf8')
    chmodSync(join(posixDir, 'gh'), 0o755)
    writeFileSync(
      join(win32Dir, 'gh.cmd'),
      WIN32_GH_PR_CAP_WRAPPER.replaceAll('\n', '\r\n'),
      'utf8'
    )
    written.add(userDataPath)
  }
  return { posixDir, win32Dir }
}

/**
 * Puts Orca's gh wrapper first on an Orca PTY's PATH, so a member's `gh pr create` past its
 * project's open-PR cap is refused for any agent (ORCA-1301). Where it cannot, the PTY keeps
 * today's PATH and the lead's watch alert still covers the cap.
 */
export function applyGhPrCapShimEnv(
  baseEnv: Record<string, string>,
  options: {
    userDataPath: string
    platform?: NodeJS.Platform
    shellFamily?: 'native-windows' | 'posix'
    ensure?: typeof ensureGhPrCapShims
  }
): boolean {
  const platform = options.platform ?? process.platform
  let dirs: { posixDir: string; win32Dir: string }
  try {
    dirs = (options.ensure ?? ensureGhPrCapShims)(options.userDataPath)
  } catch (error) {
    console.warn(
      "[gh-pr-cap] gh wrapper not installed; only the lead's watch alert covers the PR cap",
      error
    )
    return false
  }
  const nativeWindows = platform === 'win32' && options.shellFamily !== 'posix'
  // Why members only: cmd re-parses %* on every call, so the .cmd never sits in front of other users' gh.
  if (nativeWindows && !isGameMemberPane(baseEnv)) {
    return false
  }
  const dir = nativeWindows ? dirs.win32Dir : dirs.posixDir
  const delimiter = platform === 'win32' ? ';' : ':'
  const pathKey = resolvePathEnvKey(baseEnv, platform)
  const same = (entry: string): boolean =>
    platform === 'win32' ? entry.toLowerCase() === dir.toLowerCase() : entry === dir
  const rest = (baseEnv[pathKey] ?? process.env[pathKey] ?? '')
    .split(delimiter)
    .filter((entry) => entry && !same(entry))
  if (nativeWindows) {
    // Why resolved now: the .cmd cannot strip itself from PATH, so it calls the next gh by path.
    const next = resolveWindowsExecutable('gh', rest.join(delimiter))
    if (!next) {
      return false
    }
    baseEnv.ORCA_PR_CAP_NEXT_GH = next
  }
  baseEnv[pathKey] = [dir, ...rest].join(delimiter)
  // Why: Orca's shell-ready rc puts this dir back first after the user's startup files reorder PATH.
  if (!nativeWindows) {
    baseEnv.ORCA_GH_PR_CAP_SHIM_DIR = dir
  }
  return true
}

/**
 * Hands a WSL member pane the POSIX wrapper's Windows dir; WSLENV /p translates it and the WSL
 * launch and shell-ready rc put it first on the Linux PATH (ORCA-1388).
 */
export function applyWslGhPrCapShimEnv(
  baseEnv: Record<string, string>,
  options: { userDataPath: string; ensure?: typeof ensureGhPrCapShims }
): boolean {
  // Why members only: a plain WSL pane's gh pr create would pay a Windows interop round trip.
  if (!isGameMemberPane(baseEnv)) {
    delete baseEnv.ORCA_GH_PR_CAP_SHIM_DIR
    return false
  }
  try {
    baseEnv.ORCA_GH_PR_CAP_SHIM_DIR = (options.ensure ?? ensureGhPrCapShims)(
      options.userDataPath
    ).posixDir
    return true
  } catch (error) {
    console.warn(
      "[gh-pr-cap] WSL gh wrapper not installed; only the lead's watch alert covers the PR cap",
      error
    )
    delete baseEnv.ORCA_GH_PR_CAP_SHIM_DIR
    return false
  }
}
