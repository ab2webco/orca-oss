import { WINDOWS_HOOK_STDIN_READER } from '../agent-hooks/hook-stdin-contract'
import {
  CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS,
  CLAUDE_STATUSLINE_PATHNAME
} from '../../shared/claude-statusline-rate-limits'

const STATUSLINE_CLEANUP_LABEL = 'orca_statusline_cleanup'
const STATUSLINE_PROBE_LABEL = 'orca_statusline_probe'

/**
 * cmd.exe variant of the managed statusline script.
 *
 * Why its own module: the POSIX and batch generators share nothing but the payload contract,
 * and keeping both in one file pushed it past the line cap.
 */
export function getWindowsManagedStatusLineScript(): string {
  return [
    '@echo off',
    'setlocal',
    // Why: sessions outside Orca (no pane key) hit this settings.json too — they must still
    // print, so capture always runs; %RANDOM% only risks a same-second cosmetic garble here.
    'if not "%ORCA_PANE_KEY%"=="" goto :orca_statusline_pane_id',
    'set "ORCA_STATUSLINE_PANE_ID=orphan-%RANDOM%"',
    'goto :orca_statusline_capture',
    ':orca_statusline_pane_id',
    // Why: current keys end in a UUID; replacing the legacy delimiter also keeps surviving numeric-pane keys filename-safe.
    'set "ORCA_STATUSLINE_PANE_ID=%ORCA_PANE_KEY:~-36%"',
    'set "ORCA_STATUSLINE_PANE_ID=%ORCA_STATUSLINE_PANE_ID::=_%"',
    ':orca_statusline_capture',
    // Why: cmd has no builtin stdin capture, so buffer the payload in a per-pane temp file
    // (%RANDOM% collides across same-second cmd spawns) to guard before any curl spawn.
    'set "ORCA_STATUSLINE_PAYLOAD_FILE=%TEMP%\\orca-claude-statusline-%ORCA_STATUSLINE_PANE_ID%.tmp"',
    `${WINDOWS_HOOK_STDIN_READER} >"%ORCA_STATUSLINE_PAYLOAD_FILE%" 2>nul`,
    // Why: capture with plain expansion (a for-var set survives quotes/&), then parse under
    // delayed expansion so payload content is never re-tokenized as cmd syntax.
    'set "ORCA_STATUSLINE_JSON="',
    'for /f "usebackq delims=" %%x in ("%ORCA_STATUSLINE_PAYLOAD_FILE%") do if not defined ORCA_STATUSLINE_JSON set "ORCA_STATUSLINE_JSON=%%x"',
    'setlocal enabledelayedexpansion',
    'set "ORCA_STATUSLINE_MODEL="',
    'set "ORCA_STATUSLINE_CTX="',
    'if not defined ORCA_STATUSLINE_JSON goto :orca_statusline_emit',
    // Why: strip through the value's opening quote, turn remaining quotes into delimiters,
    // and take token 1 — pure-builtin field extraction with no subprocess per tick.
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"display_name"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_model_id',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:*"=!"',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:"=,!"',
    'if "!ORCA_STATUSLINE_REST:~0,1!"=="," goto :orca_statusline_model_id',
    'for /f "delims=," %%m in ("!ORCA_STATUSLINE_REST!") do if not defined ORCA_STATUSLINE_MODEL set "ORCA_STATUSLINE_MODEL=%%m"',
    ':orca_statusline_model_id',
    // Why: mirror parseModelLabel's display_name → model.id fallback so older CLIs still label the line.
    'if defined ORCA_STATUSLINE_MODEL goto :orca_statusline_context',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"model"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_context',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_REST:*"id"=!"',
    'if "!ORCA_STATUSLINE_NEXT!"=="!ORCA_STATUSLINE_REST!" goto :orca_statusline_context',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:*"=!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:"=,!"',
    'if "!ORCA_STATUSLINE_NEXT:~0,1!"=="," goto :orca_statusline_context',
    'for /f "delims=," %%m in ("!ORCA_STATUSLINE_NEXT!") do if not defined ORCA_STATUSLINE_MODEL set "ORCA_STATUSLINE_MODEL=%%m"',
    ':orca_statusline_context',
    // Why: scope the search to context_window so rate_limits' used_percentage (a different
    // metric) can never masquerade as context usage; cap at 16 chars before tokenizing.
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"context_window"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_compose',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_REST:*"used_percentage"=!"',
    'if "!ORCA_STATUSLINE_NEXT!"=="!ORCA_STATUSLINE_REST!" goto :orca_statusline_compose',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:*:=!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:~0,16!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:"=,!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT: =!"',
    'for /f "delims=.,}" %%p in ("!ORCA_STATUSLINE_NEXT!") do if not defined ORCA_STATUSLINE_CTX set "ORCA_STATUSLINE_CTX=%%p"',
    'for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_CTX!") do set "ORCA_STATUSLINE_CTX="',
    'if defined ORCA_STATUSLINE_CTX if not "!ORCA_STATUSLINE_CTX:~3!"=="" set "ORCA_STATUSLINE_CTX="',
    ':orca_statusline_compose',
    'set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_MODEL!"',
    'if not defined ORCA_STATUSLINE_CTX goto :orca_statusline_emit',
    'if defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_LINE! | ctx !ORCA_STATUSLINE_CTX!%%"',
    'if not defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=ctx !ORCA_STATUSLINE_CTX!%%"',
    ':orca_statusline_emit',
    // Why: stdout IS the status line — echo( survives arbitrary expanded content.
    'if defined ORCA_STATUSLINE_LINE echo(!ORCA_STATUSLINE_LINE!',
    'endlocal',
    // Why: no pane key means no Orca to feed — print-only sessions never post.
    `if "%ORCA_PANE_KEY%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
    // Why: an all-builtin seconds-of-day throttle avoids spawning findstr+curl on every streaming tick.
    'set "ORCA_STATUSLINE_STAMP_FILE=%TEMP%\\orca-claude-statusline-last-%ORCA_STATUSLINE_PANE_ID%.tmp"',
    'set "ORCA_STATUSLINE_NOW="',
    'set "ORCA_STATUSLINE_TIME=%TIME: =0%"',
    'for /f "tokens=1-3 delims=:.," %%a in ("%ORCA_STATUSLINE_TIME%") do set /a "ORCA_STATUSLINE_NOW=(1%%a %% 100)*3600+(1%%b %% 100)*60+(1%%c %% 100)" 2>nul',
    'set "ORCA_STATUSLINE_LAST="',
    'set "ORCA_STATUSLINE_ELAPSED="',
    'if exist "%ORCA_STATUSLINE_STAMP_FILE%" set /p ORCA_STATUSLINE_LAST=<"%ORCA_STATUSLINE_STAMP_FILE%"',
    'if defined ORCA_STATUSLINE_LAST for /f "delims=0123456789" %%d in ("%ORCA_STATUSLINE_LAST%") do set "ORCA_STATUSLINE_LAST="',
    'if defined ORCA_STATUSLINE_NOW if defined ORCA_STATUSLINE_LAST set /a "ORCA_STATUSLINE_ELAPSED=ORCA_STATUSLINE_NOW-ORCA_STATUSLINE_LAST" 2>nul',
    `if not defined ORCA_STATUSLINE_ELAPSED goto :${STATUSLINE_PROBE_LABEL}`,
    `if %ORCA_STATUSLINE_ELAPSED% GEQ 0 if %ORCA_STATUSLINE_ELAPSED% LSS ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} goto :${STATUSLINE_CLEANUP_LABEL}`,
    `:${STATUSLINE_PROBE_LABEL}`,
    // Why: rate_limits appears only for Claude.ai-subscriber sessions after the first API response; the
    // statusline ticks ~3x/sec during streaming, so skip the endpoint call and curl spawn otherwise.
    // Why: \" is the MSVC argv escape — findstr sees the quoted JSON key, so a cwd containing rate_limits can't false-match (POSIX guard parity).
    '"%SystemRoot%\\System32\\findstr.exe" /c:\\"rate_limits\\" "%ORCA_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
    `if errorlevel 1 goto :${STATUSLINE_CLEANUP_LABEL}`,
    // Why: call the endpoint file to refresh port/token — a PTY that survived an Orca restart carries stale env; falls through to PTY env if missing.
    'if defined ORCA_AGENT_HOOK_ENDPOINT if exist "%ORCA_AGENT_HOOK_ENDPOINT%" call "%ORCA_AGENT_HOOK_ENDPOINT%" 2>nul',
    `if "%ORCA_AGENT_HOOK_PORT%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
    `if "%ORCA_AGENT_HOOK_TOKEN%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
    // Why: stamp only when a post is certain, so skipped ticks (no rate_limits, missing port/token) never push the next allowed post out.
    'if defined ORCA_STATUSLINE_NOW (>"%ORCA_STATUSLINE_STAMP_FILE%" echo %ORCA_STATUSLINE_NOW%)',
    // Why: pre-build the field from an always-defined variable so an unset CLAUDE_CONFIG_DIR posts
    // empty (matching POSIX and the null attribution snapshot), never a literal %VAR% token.
    'set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir="',
    'if defined CLAUDE_CONFIG_DIR set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir=%CLAUDE_CONFIG_DIR%"',
    [
      '"%SystemRoot%\\System32\\curl.exe" -sS -X POST',
      `"http://127.0.0.1:%ORCA_AGENT_HOOK_PORT%${CLAUDE_STATUSLINE_PATHNAME}"`,
      '--connect-timeout 0.5 --max-time 1.5',
      '-H "Content-Type: application/x-www-form-urlencoded"',
      '-H "X-Orca-Agent-Hook-Token: %ORCA_AGENT_HOOK_TOKEN%"',
      '--data-urlencode "paneKey=%ORCA_PANE_KEY%"',
      '--data-urlencode "%ORCA_STATUSLINE_CONFIG_DIR_FIELD%"',
      '--data-urlencode "env=%ORCA_AGENT_HOOK_ENV%"',
      '--data-urlencode "version=%ORCA_AGENT_HOOK_VERSION%"',
      '--data-urlencode "payload@%ORCA_STATUSLINE_PAYLOAD_FILE%"',
      '>nul 2>&1'
    ].join(' '),
    `:${STATUSLINE_CLEANUP_LABEL}`,
    'del "%ORCA_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
    'exit /b 0',
    ''
  ].join('\r\n')
}
