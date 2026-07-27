import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS } from '../../shared/claude-statusline-rate-limits'
import { getManagedStatusLineScript } from './statusline-script'

const ORIGINAL_PLATFORM = process.platform

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: ORIGINAL_PLATFORM })
})

describe('getManagedStatusLineScript (posix)', () => {
  it('guards on rate_limits before sourcing the endpoint or spawning curl', () => {
    stubPlatform('darwin')
    const script = getManagedStatusLineScript('local')
    expect(script).toBe(getManagedStatusLineScript('posix'))
    // Why anchor on the `) ;;` form: the quota extraction also matches on "rate_limits",
    // so a bare key match would find that earlier block instead of the guard.
    const guardIndex = script.indexOf('*\'"rate_limits"\'*) ;;')
    const endpointIndex = script.indexOf('ORCA_AGENT_HOOK_ENDPOINT')
    const curlIndex = script.indexOf('curl -sS')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(endpointIndex)
    expect(endpointIndex).toBeLessThan(curlIndex)
    expect(script).toContain('/statusline/claude')
    expect(script).toContain('--data-urlencode "payload@-"')
  })

  it('returns the posix script even on win32 when targeting a remote', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('posix')
    expect(script).toContain('#!/bin/sh')
    expect(script).not.toContain('curl.exe')
  })

  it('prints before the rate_limits guard and the throttle so the render never flickers', () => {
    stubPlatform('darwin')
    const script = getManagedStatusLineScript('local')
    const printIndex = script.indexOf(`printf '%s\\n' "$orca_statusline_line"`)
    // Why anchor on the `) ;;` form: the quota extraction also matches on "rate_limits",
    // so a bare key match would find that earlier block instead of the guard.
    const guardIndex = script.indexOf('*\'"rate_limits"\'*) ;;')
    const stampIndex = script.indexOf('orca-claude-statusline-last-')
    expect(printIndex).toBeGreaterThan(-1)
    expect(printIndex).toBeLessThan(guardIndex)
    expect(printIndex).toBeLessThan(stampIndex)
  })
})

describe('getManagedStatusLineScript (win32 local)', () => {
  it('guards on rate_limits via findstr before the endpoint call and curl spawn', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    const captureIndex = script.indexOf('more.com')
    // Why: the \"-escaped needle makes findstr match the quoted JSON key, not any path containing rate_limits.
    const guardIndex = script.indexOf('findstr.exe" /c:\\"rate_limits\\"')
    const endpointIndex = script.indexOf('call "%ORCA_AGENT_HOOK_ENDPOINT%"')
    const curlIndex = script.indexOf('curl.exe')
    expect(captureIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(captureIndex)
    expect(guardIndex).toBeLessThan(endpointIndex)
    expect(endpointIndex).toBeLessThan(curlIndex)
    expect(script).toContain('if errorlevel 1 goto :orca_statusline_cleanup')
  })

  it('posts the buffered payload file and deletes it afterwards', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    // Why: the stable leaf UUID stays filename-safe even when a host-supplied tab id does not,
    // while the delimiter replacement keeps a surviving legacy numeric key valid on Windows.
    expect(script).toContain('set "ORCA_STATUSLINE_PANE_ID=%ORCA_PANE_KEY:~-36%"')
    expect(script).toContain('set "ORCA_STATUSLINE_PANE_ID=%ORCA_STATUSLINE_PANE_ID::=_%"')
    expect(script).toContain(
      'set "ORCA_STATUSLINE_PAYLOAD_FILE=%TEMP%\\orca-claude-statusline-%ORCA_STATUSLINE_PANE_ID%.tmp"'
    )
    expect(script).toContain('--data-urlencode "payload@%ORCA_STATUSLINE_PAYLOAD_FILE%"')
    expect(script).not.toContain('payload@-')
    const curlIndex = script.indexOf('curl.exe')
    const delIndex = script.indexOf('del "%ORCA_STATUSLINE_PAYLOAD_FILE%"')
    expect(delIndex).toBeGreaterThan(curlIndex)
  })

  it('never posts a literal %CLAUDE_CONFIG_DIR% token when the var is unset', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    // Why: the posted field comes from an always-defined variable so an unset
    // CLAUDE_CONFIG_DIR yields "configDir=" (matching POSIX + the null snapshot).
    expect(script).toContain('set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir="')
    expect(script).toContain(
      'if defined CLAUDE_CONFIG_DIR set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir=%CLAUDE_CONFIG_DIR%"'
    )
    expect(script).toContain('--data-urlencode "%ORCA_STATUSLINE_CONFIG_DIR_FIELD%"')
    expect(script).not.toContain('"configDir=%CLAUDE_CONFIG_DIR%"')
  })

  it('captures and prints even when the pane key is missing, but never posts', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    // Why: sessions outside Orca share this settings.json — a silent drain there is the blank-line bug.
    expect(script).not.toContain(':orca_agent_hook_drain_stdin')
    expect(script).toContain('set "ORCA_STATUSLINE_PANE_ID=orphan-%RANDOM%"')
    const printIndex = script.indexOf('echo(!ORCA_STATUSLINE_LINE!')
    const forwardGuardIndex = script.indexOf(
      `if "%ORCA_PANE_KEY%"=="" goto :orca_statusline_cleanup`
    )
    const findstrIndex = script.indexOf('findstr.exe')
    expect(printIndex).toBeGreaterThan(-1)
    expect(forwardGuardIndex).toBeGreaterThan(printIndex)
    expect(forwardGuardIndex).toBeLessThan(findstrIndex)
  })

  it('prints before the throttle check so the render is never debounced', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    const captureIndex = script.indexOf('more.com')
    const delayedExpansionIndex = script.indexOf('setlocal enabledelayedexpansion')
    const printIndex = script.indexOf('echo(!ORCA_STATUSLINE_LINE!')
    const stampIndex = script.indexOf('ORCA_STATUSLINE_STAMP_FILE=')
    const findstrIndex = script.indexOf('findstr.exe')
    expect(captureIndex).toBeLessThan(delayedExpansionIndex)
    expect(delayedExpansionIndex).toBeLessThan(printIndex)
    // Why: the stamp throttle and rate_limits guard exit early — printing after either would flicker.
    expect(printIndex).toBeLessThan(stampIndex)
    expect(printIndex).toBeLessThan(findstrIndex)
  })

  it('scopes the context percentage to context_window, not rate_limits', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    const contextStripIndex = script.indexOf(':*"context_window"=')
    const usedStripIndex = script.indexOf(':*"used_percentage"=')
    expect(contextStripIndex).toBeGreaterThan(-1)
    expect(usedStripIndex).toBeGreaterThan(contextStripIndex)
    // Digits-only validation caps the printed value at three characters.
    expect(script).toContain(
      'for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_CTX!") do set "ORCA_STATUSLINE_CTX="'
    )
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_CTX if not "!ORCA_STATUSLINE_CTX:~3!"=="" set "ORCA_STATUSLINE_CTX="'
    )
  })

  it('throttles with an all-builtin seconds-of-day stamp that fails open to posting', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    const captureIndex = script.indexOf('more.com')
    const stampIndex = script.indexOf(
      'set "ORCA_STATUSLINE_STAMP_FILE=%TEMP%\\orca-claude-statusline-last-%ORCA_STATUSLINE_PANE_ID%.tmp"'
    )
    const throttleIndex = script.indexOf(
      `if %ORCA_STATUSLINE_ELAPSED% GEQ 0 if %ORCA_STATUSLINE_ELAPSED% LSS ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} goto :orca_statusline_cleanup`
    )
    const findstrIndex = script.indexOf('findstr.exe')
    const stampWriteIndex = script.indexOf(
      'if defined ORCA_STATUSLINE_NOW (>"%ORCA_STATUSLINE_STAMP_FILE%" echo %ORCA_STATUSLINE_NOW%)'
    )
    const tokenGuardIndex = script.indexOf('if "%ORCA_AGENT_HOOK_TOKEN%"=="" goto')
    const curlIndex = script.indexOf('curl.exe')
    // Why: the check precedes findstr so throttled ticks skip that spawn too, but the stamp
    // only advances after every post guard passes — skipped ticks must not defer the next post.
    expect(stampIndex).toBeGreaterThan(captureIndex)
    expect(throttleIndex).toBeGreaterThan(stampIndex)
    expect(throttleIndex).toBeLessThan(findstrIndex)
    expect(stampWriteIndex).toBeGreaterThan(tokenGuardIndex)
    expect(stampWriteIndex).toBeLessThan(curlIndex)
    // Fail-open shape: undefined elapsed (unparseable time/stamp) proceeds to the probe.
    expect(script).toContain('if not defined ORCA_STATUSLINE_ELAPSED goto :orca_statusline_probe')
    expect(script).toContain(
      'for /f "delims=0123456789" %%d in ("%ORCA_STATUSLINE_LAST%") do set "ORCA_STATUSLINE_LAST="'
    )
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_NOW if defined ORCA_STATUSLINE_LAST set /a "ORCA_STATUSLINE_ELAPSED=ORCA_STATUSLINE_NOW-ORCA_STATUSLINE_LAST" 2>nul'
    )
    // cmd parses leading-zero numbers as octal; 1%%x %% 100 defuses 08/09.
    expect(script).toContain('(1%%a %% 100)*3600+(1%%b %% 100)*60+(1%%c %% 100)')
    expect(script).toContain('set "ORCA_STATUSLINE_TIME=%TIME: =0%"')
  })
})

describe('statusline curl throttle (posix)', () => {
  it('checks the per-pane stamp after the env guards and before curl', () => {
    stubPlatform('darwin')
    const script = getManagedStatusLineScript('local')
    const envGuardIndex = script.indexOf('-z "$ORCA_AGENT_HOOK_PORT"')
    const durationIndex = script.indexOf('"total_duration_ms"')
    const stampIndex = script.indexOf('orca-claude-statusline-last-${orca_statusline_pane_id}')
    const intervalIndex = script.indexOf(`-lt ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS}`)
    const curlIndex = script.indexOf('curl -sS')
    expect(envGuardIndex).toBeLessThan(stampIndex)
    expect(stampIndex).toBeLessThan(durationIndex)
    expect(durationIndex).toBeLessThan(intervalIndex)
    expect(intervalIndex).toBeLessThan(curlIndex)
    // Fail-open shape: non-numeric date output or stamp content must never suppress the post.
    // Why: the allow-list (not a mere digits check) matters — leading-zero values like 008 are
    // invalid octal inside $(( )) and abort the whole script under dash, wedging the stamp.
    expect(script).toContain(
      'case "$orca_statusline_now" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_now='
    )
    expect(script).toContain(
      'case "$orca_statusline_last" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_last='
    )
  })
})

describe.skipIf(process.platform === 'win32')('statusline curl throttle (posix behavioral)', () => {
  const LEAF_ID = '00000000-0000-4000-8000-000000000000'
  const PANE_KEY = 'tab-1:00000000-0000-4000-8000-000000000000'
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function rateLimitPayload(durationMs: number): string {
    return JSON.stringify({
      cost: { total_duration_ms: durationMs },
      rate_limits: { five_hour: { used_percentage: 12 } }
    })
  }

  // Mirrors the CLI's statusline payload shape: context_window.current_usage nests the raw
  // API usage and rate_limits carries a same-named but unrelated used_percentage.
  function displayPayload(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      model: { id: 'claude-fable-5', display_name: 'Fable' },
      workspace: { current_dir: '/tmp/x', project_dir: '/tmp/x' },
      cost: { total_duration_ms: 1_000 },
      context_window: {
        total_input_tokens: 85_400,
        total_output_tokens: 1_200,
        context_window_size: 200_000,
        current_usage: { input_tokens: 3, cache_read_input_tokens: 85_000, output_tokens: 19 },
        used_percentage: 42.7,
        remaining_percentage: 57.3
      },
      ...overrides
    })
  }

  function makeHarness(): {
    scriptPath: string
    dir: string
    curlLog: string
    payloadLog: string
    dateLog: string
    catLog: string
  } {
    const dir = mkdtempSync(join(tmpdir(), 'orca-statusline-throttle-'))
    dirs.push(dir)
    const curlLog = join(dir, 'curl.log')
    const payloadLog = join(dir, 'payload.log')
    const dateLog = join(dir, 'date.log')
    const catLog = join(dir, 'cat.log')
    const scriptPath = join(dir, 'statusline.sh')
    writeFileSync(scriptPath, getManagedStatusLineScript('posix'))
    const binDir = join(dir, 'stub-bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(
      join(binDir, 'curl'),
      `#!/bin/sh\n/bin/cat > "${payloadLog}"\nprintf 'x\\n' >> "${curlLog}"\nexit 0\n`,
      { mode: 0o755 }
    )
    writeFileSync(
      join(binDir, 'date'),
      `#!/bin/sh\nprintf 'x\\n' >> "${dateLog}"\nprintf '2000000000\\n'\n`,
      { mode: 0o755 }
    )
    writeFileSync(join(binDir, 'cat'), `#!/bin/sh\nprintf 'x\\n' >> "${catLog}"\n/bin/cat "$@"\n`, {
      mode: 0o755
    })
    return { scriptPath, dir, curlLog, payloadLog, dateLog, catLog }
  }

  function runScript(
    scriptPath: string,
    dir: string,
    payload: string,
    paneKey = PANE_KEY,
    configDir?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', [scriptPath], {
        env: {
          PATH: `${join(dir, 'stub-bin')}:${process.env.PATH ?? ''}`,
          TMPDIR: dir,
          ORCA_AGENT_HOOK_PORT: '65535',
          ORCA_AGENT_HOOK_TOKEN: 'test-token',
          ORCA_PANE_KEY: paneKey,
          ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {})
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`statusline script exited ${code}: ${stderr}`))
        }
      })
      child.stdin.write(payload)
      child.stdin.end()
    })
  }

  function lineCount(logPath: string): number {
    try {
      return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    } catch {
      return 0
    }
  }

  // Why code points and not `.length`: the budget is a column budget, and a bar cell is one
  // column. Measuring anything else is the mistake the script itself has to avoid.
  function columns(line: string): number {
    return [...line.trimEnd()].length
  }

  function stampPathFor(dir: string, leafId = LEAF_ID): string {
    return join(dir, `orca-claude-statusline-last-${leafId}`)
  }

  it('spawns one curl and no capture or clock subprocesses across 30 rapid ticks', async () => {
    const { scriptPath, dir, curlLog, dateLog, catLog } = makeHarness()
    for (let index = 0; index < 30; index += 1) {
      await runScript(scriptPath, dir, rateLimitPayload(1_000 + index * 100))
    }
    expect(lineCount(curlLog)).toBe(1)
    expect(lineCount(dateLog)).toBe(0)
    expect(lineCount(catLog)).toBe(0)
    expect(readFileSync(stampPathFor(dir), 'utf8')).toMatch(/^[0-9]+$/)
  })

  it('posts again once the interval has elapsed', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    await runScript(scriptPath, dir, rateLimitPayload(1_000))
    await runScript(scriptPath, dir, rateLimitPayload(16_000))
    expect(lineCount(curlLog)).toBe(2)
  })

  it('stays bounded and keeps a valid stamp under overlapping same-pane ticks', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    // Why: the stamp check/write is deliberately lock-free — a lock could wedge the feed closed,
    // and fail-open is the contract — so a truly concurrent burst may post more than once,
    // bounded by the overlap width. The deterministic invariants are: every overlapping run
    // exits 0, the raced stamp still lands valid, and it throttles the very next ticks.
    await Promise.all(
      Array.from({ length: 10 }, () => runScript(scriptPath, dir, rateLimitPayload(1_000)))
    )
    const burstPosts = lineCount(curlLog)
    expect(burstPosts).toBeGreaterThanOrEqual(1)
    expect(readFileSync(stampPathFor(dir), 'utf8')).toBe('1')
    for (let index = 0; index < 5; index += 1) {
      await runScript(scriptPath, dir, rateLimitPayload(2_000 + index * 100))
    }
    expect(lineCount(curlLog)).toBe(burstPosts)
  })

  it('preserves multiline payloads while capturing stdin with shell builtins', async () => {
    const { scriptPath, dir, payloadLog } = makeHarness()
    const payload = JSON.stringify(JSON.parse(rateLimitPayload(1_000)), null, 2)
    await runScript(scriptPath, dir, payload)
    expect(readFileSync(payloadLog, 'utf8')).toBe(payload)
  })

  it('fails open on a garbage stamp even early in a session', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    writeFileSync(stampPathFor(dir), 'not-a-number')
    await runScript(scriptPath, dir, rateLimitPayload(1_000))
    expect(lineCount(curlLog)).toBe(1)
    expect(readFileSync(stampPathFor(dir), 'utf8')).toMatch(/^[0-9]+$/)
  })

  it('fails open and repairs a leading-zero stamp instead of dying in arithmetic', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    // Why: 008 is all-digits but invalid octal inside $(( )) — under dash the old digits-only
    // check made the script abort before rewriting the stamp, wedging this pane's feed dark.
    writeFileSync(stampPathFor(dir), '008')
    await runScript(scriptPath, dir, rateLimitPayload(1_000))
    expect(lineCount(curlLog)).toBe(1)
    expect(readFileSync(stampPathFor(dir), 'utf8')).toBe('1')
  })

  it('uses the clock fallback when the payload omits session duration', async () => {
    const { scriptPath, dir, curlLog, dateLog } = makeHarness()
    const payload = '{"rate_limits":{"five_hour":{"used_percentage":12}}}'
    await runScript(scriptPath, dir, payload)
    await runScript(scriptPath, dir, payload)
    expect(lineCount(curlLog)).toBe(1)
    expect(lineCount(dateLog)).toBe(2)
  })

  it('uses only the stable leaf id for temp files', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    const paneKey = `${'path/segment/'.repeat(30)}tab:${LEAF_ID}`
    await runScript(scriptPath, dir, rateLimitPayload(1_000), paneKey)
    await runScript(scriptPath, dir, rateLimitPayload(2_000), paneKey)
    expect(lineCount(curlLog)).toBe(1)
    expect(readFileSync(stampPathFor(dir), 'utf8')).toBe('1')
  })

  it('keeps legacy numeric pane ids isolated by tab', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    await runScript(scriptPath, dir, rateLimitPayload(1_000), 'legacy-tab-a:1')
    await runScript(scriptPath, dir, rateLimitPayload(1_000), 'legacy-tab-b:1')
    expect(lineCount(curlLog)).toBe(2)
    expect(readFileSync(stampPathFor(dir, 'legacy-tab-a_1'), 'utf8')).toBe('1')
    expect(readFileSync(stampPathFor(dir, 'legacy-tab-b_1'), 'utf8')).toBe('1')
  })

  it('never touches curl or the stamp for payloads without rate_limits', async () => {
    const { scriptPath, dir, curlLog, dateLog } = makeHarness()
    await runScript(scriptPath, dir, '{"model":{"id":"claude-fable-5"}}')
    expect(lineCount(curlLog)).toBe(0)
    expect(lineCount(dateLog)).toBe(0)
    expect(() => readFileSync(stampPathFor(dir), 'utf8')).toThrow()
  })

  it('prints model and context usage for a payload without rate_limits (the flicker case)', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    const stdout = await runScript(scriptPath, dir, displayPayload())
    expect(stdout).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42%\n')
    expect(lineCount(curlLog)).toBe(0)
  })

  it('prints and still forwards when rate_limits are present', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    const stdout = await runScript(
      scriptPath,
      dir,
      displayPayload({ rate_limits: { five_hour: { used_percentage: 12 } } })
    )
    expect(stdout).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42% · 5h ▌░░░░ 12%\n')
    expect(lineCount(curlLog)).toBe(1)
  })

  it('prints on every tick while the forward stays debounced', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    const payloadFor = (durationMs: number): string =>
      displayPayload({
        cost: { total_duration_ms: durationMs },
        rate_limits: { five_hour: { used_percentage: 12 } }
      })
    const first = await runScript(scriptPath, dir, payloadFor(1_000))
    const second = await runScript(scriptPath, dir, payloadFor(2_000))
    const third = await runScript(scriptPath, dir, payloadFor(3_000))
    // Why the first line differs: the lab identity announces once per pane, so a banner
    // cannot strobe on a line the CLI requests several times a second.
    expect(first).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42% · 5h ▌░░░░ 12%\n')
    expect(second).toBe('Fable · ctx ██░░░ 42% → · 5h ▌░░░░ 12%\n')
    expect(third).toBe('Fable · ctx ██░░░ 42% → · 5h ▌░░░░ 12%\n')
    expect(lineCount(curlLog)).toBe(1)
  })

  it('never reads rate-limit percentages as context usage', async () => {
    const { scriptPath, dir } = makeHarness()
    const stdout = await runScript(
      scriptPath,
      dir,
      JSON.stringify({
        model: { id: 'claude-fable-5', display_name: 'Fable' },
        cost: { total_duration_ms: 1_000 },
        rate_limits: { five_hour: { used_percentage: 12 } }
      })
    )
    // The 12% is the five-hour quota, labelled as such — never borrowed as context usage.
    expect(stdout).toBe('Orca by Ab2Web · Fable · 5h ▌░░░░ 12%\n')
  })

  it('falls back to model.id when display_name is absent', async () => {
    const { scriptPath, dir } = makeHarness()
    const parsed = JSON.parse(displayPayload()) as { model: Record<string, unknown> }
    parsed.model = { id: 'claude-fable-5' }
    const stdout = await runScript(scriptPath, dir, JSON.stringify(parsed))
    expect(stdout).toBe('Orca by Ab2Web · claude-fable-5 · ctx ██░░░ 42%\n')
  })

  it('prints from a pretty-printed payload too', async () => {
    const { scriptPath, dir } = makeHarness()
    const stdout = await runScript(
      scriptPath,
      dir,
      JSON.stringify(JSON.parse(displayPayload()), null, 2)
    )
    expect(stdout).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42%\n')
  })

  it('renders the account from the vault, truncated at the domain', async () => {
    const { scriptPath, dir } = makeHarness()
    const configDir = join(dir, 'claude-accounts', 'acct-1234', 'auth')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'oauth-account.json'),
      JSON.stringify({ emailAddress: 'fabian.altahona@koombea.com', displayName: 'Fabian' })
    )
    const stdout = await runScript(scriptPath, dir, displayPayload(), PANE_KEY, configDir)
    // Why the local part survives and the domain does not: several accounts share one domain,
    // so the local part is what disambiguates, and the whole line has to fit a narrow pane.
    expect(stdout).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42% · @fabian.altahona@\n')
  })

  it('reads the vault once and serves the account from a cache keyed to the config dir', async () => {
    const { scriptPath, dir } = makeHarness()
    const configDir = join(dir, 'claude-accounts', 'acct-cache', 'auth')
    mkdirSync(configDir, { recursive: true })
    const vault = join(configDir, 'oauth-account.json')
    writeFileSync(vault, JSON.stringify({ emailAddress: 'first@example.com' }))
    await runScript(scriptPath, dir, displayPayload(), PANE_KEY, configDir)
    // Why rewrite then re-run: a second read of the vault would pick the new value up. The cache
    // must serve the first one, proving this runs at most once per account rather than per tick.
    writeFileSync(vault, JSON.stringify({ emailAddress: 'second@example.com' }))
    const cached = await runScript(scriptPath, dir, displayPayload(), PANE_KEY, configDir)
    expect(cached).toContain('@first@')
    expect(cached).not.toContain('second')
  })

  it('bounds a long address instead of letting it push quota off the line', async () => {
    const { scriptPath, dir } = makeHarness()
    const configDir = join(dir, 'claude-accounts', 'acct-long', 'auth')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'oauth-account.json'),
      JSON.stringify({ emailAddress: `${'a'.repeat(60)}@example.com` })
    )
    const stdout = await runScript(
      scriptPath,
      dir,
      displayPayload({
        rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 45 } }
      }),
      PANE_KEY,
      configDir
    )
    // Why assert the bound and not a ladder: with the account itself bounded, the line is short
    // by construction, so quota survives. A wrapped status line reads as a broken app, and the
    // one field that could have caused it is the address — so that is what gets shortened.
    expect(columns(stdout)).toBeLessThanOrEqual(96)
    expect(stdout).toContain('5h ▌░░░░ 12%')
    expect(stdout).toContain('7d ██░░░ 45%')
    expect(stdout).not.toContain('a'.repeat(30))
  })

  it('fills the context bar in proportion to consumption, and only fills it at 100', async () => {
    const { scriptPath, dir } = makeHarness()
    const barFor = async (percent: number, pane: string): Promise<string> => {
      const stdout = await runScript(
        scriptPath,
        dir,
        displayPayload({ context_window: { used_percentage: percent } }),
        `tab-1:bar-${pane}`
      )
      return stdout.trimEnd()
    }
    // Why 99 still shows a half cell: a bar that rounds up would claim consumption that has not
    // happened, and reserving the all-full bar for a true 100% makes exhaustion unmistakable.
    expect(await barFor(0, 'a')).toBe('Orca by Ab2Web · Fable · ctx ░░░░░ 0%')
    expect(await barFor(50, 'b')).toBe('Orca by Ab2Web · Fable · ctx ██▌░░ 50%')
    expect(await barFor(99, 'c')).toBe('Orca by Ab2Web · Fable · ctx ████▌ 99%')
    expect(await barFor(100, 'd')).toBe('Orca by Ab2Web · Fable · ctx █████ 100%')
  })

  it('claims no direction until it has a baseline, then only past the flicker threshold', async () => {
    const { scriptPath, dir } = makeHarness()
    const tick = async (percent: number): Promise<string> => {
      const stdout = await runScript(
        scriptPath,
        dir,
        displayPayload({ context_window: { used_percentage: percent } }),
        'tab-1:trend-pane'
      )
      return stdout.trimEnd()
    }
    // Why the first tick carries no arrow: a direction invented from a missing baseline is a lie.
    expect(await tick(40)).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 40%')
    expect(await tick(40)).toBe('Fable · ctx ██░░░ 40% →')
    expect(await tick(41)).toBe('Fable · ctx ██░░░ 41% →')
    expect(await tick(46)).toBe('Fable · ctx ██░░░ 46% ↑')
    expect(await tick(20)).toBe('Fable · ctx █░░░░ 20% ↓')
  })

  it('accumulates a drift the threshold alone would swallow', async () => {
    const { scriptPath, dir } = makeHarness()
    const tick = async (percent: number): Promise<string> => {
      const stdout = await runScript(
        scriptPath,
        dir,
        displayPayload({ context_window: { used_percentage: percent } }),
        'tab-1:drift-pane'
      )
      return stdout.trimEnd()
    }
    // Why this matters: the baseline is the last *significant* level, not the previous tick. If it
    // were rewritten every tick, a context climbing one point per turn would read steady forever.
    await tick(40)
    expect(await tick(41)).toContain('→')
    expect(await tick(42)).toContain('↑')
  })

  it('draws no quota bar at all rather than a bar at zero when rate_limits are absent', async () => {
    const { scriptPath, dir } = makeHarness()
    const stdout = await runScript(scriptPath, dir, displayPayload(), 'tab-1:degrade-a')
    // Why never a 0% bar: an empty bar reads as real data, and a false zero is worse than nothing.
    expect(stdout.trimEnd()).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42%')
    const partial = await runScript(
      scriptPath,
      dir,
      displayPayload({
        rate_limits: { five_hour: { resets_at: 'later' }, seven_day: { used_percentage: 81 } }
      }),
      'tab-1:degrade-b'
    )
    expect(partial.trimEnd()).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42% · 7d ████░ 81%')
  })

  it('drops quota from the bottom up when the line runs out of columns', async () => {
    const { scriptPath, dir } = makeHarness()
    const configDir = join(dir, 'claude-accounts', 'acct-narrow', 'auth')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'oauth-account.json'),
      JSON.stringify({ emailAddress: `${'a'.repeat(60)}@example.com` })
    )
    const lineFor = async (displayName: string, pane: string): Promise<string> => {
      const payload = displayPayload({
        model: { id: 'claude-opus-5', display_name: displayName },
        context_window: { used_percentage: 93 },
        rate_limits: { five_hour: { used_percentage: 88 }, seven_day: { used_percentage: 77 } }
      })
      // Why measure the second tick: the banner shows once per pane, so the steady-state line —
      // trend arrow included — is what the user actually looks at.
      await runScript(scriptPath, dir, payload, `tab-1:narrow-${pane}`, configDir)
      const stdout = await runScript(scriptPath, dir, payload, `tab-1:narrow-${pane}`, configDir)
      expect(columns(stdout)).toBeLessThanOrEqual(96)
      return stdout.trimEnd()
    }
    // Why columns and not bytes: a bar cell is three bytes and one column, so a byte-measured
    // budget would drop quota that fits. Context is the field that never falls.
    expect(await lineFor('Opus 5', 'a')).toContain('7d ███▌░ 77%')
    expect(await lineFor('Claude Opus 5 (1M context) preview', 'b')).toBe(
      'Claude Opus 5 (1M context) preview · ctx ████▌ 93% → · @aaaaaaaaaaaaaaaaaaaa…@ · 5h ████░ 88%'
    )
    expect(await lineFor('Claude Opus 5 (1M context) preview build 2026', 'c')).toBe(
      'Claude Opus 5 (1M context) preview build 2026 · ctx ████▌ 93% → · @aaaaaaaaaaaaaaaaaaaa…@'
    )
  })

  it('prints without any Orca env so sessions outside Orca keep their line', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn('sh', [scriptPath], {
        env: { PATH: `${join(dir, 'stub-bin')}:${process.env.PATH ?? ''}`, TMPDIR: dir },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      let out = ''
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', () => resolve(out))
      child.stdin.write(displayPayload({ rate_limits: { five_hour: { used_percentage: 12 } } }))
      child.stdin.end()
    })
    // Why no identity here: with no pane key and no config dir there is nothing to key the
    // once-per-pane marker to, so the banner is skipped rather than repeated every tick.
    expect(stdout).toBe('Fable · ctx ██░░░ 42% · 5h ▌░░░░ 12%\n')
    expect(lineCount(curlLog)).toBe(0)
  })
})
