import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CLAUDE_STATUSLINE_ITEMS } from '../../shared/claude-statusline-items'
import { getWindowsManagedStatusLineScript } from './statusline-script-windows'
import {
  deriveStatusLineBarCells,
  statuslineBarLevelsAscii,
  statuslineBarLevelsUnicode,
  STATUSLINE_RESET_MARK_ASCII,
  STATUSLINE_RESET_MAX_CHARS,
  STATUSLINE_TREND_ASCII,
  STATUSLINE_TREND_THRESHOLD
} from './statusline-usage-gauge'

const script = getWindowsManagedStatusLineScript()
const lines = script.split('\r\n')
const DEFAULT_BAR_CELLS = deriveStatusLineBarCells(DEFAULT_CLAUDE_STATUSLINE_ITEMS)

function sliceBetween(start: string, end: string): string {
  const from = script.indexOf(start)
  const to = script.indexOf(end)
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return script.slice(from, to)
}

// Why these run on every platform: a batch script that cannot be executed here fails the same
// way the bug did — by printing nothing — so the structural invariants are the only guard that
// runs in CI. `pr.yml` runs vitest on ubuntu only, so the win32 suite below never runs there.
describe('getWindowsManagedStatusLineScript (structure)', () => {
  it('resolves every goto to exactly one label', () => {
    const labels = lines
      .filter((line) => /^:[A-Za-z0-9_]+$/.test(line))
      .map((line) => line.slice(1))
    const targets = [...script.matchAll(/goto :([A-Za-z0-9_]+)/g)].map((match) => match[1])
    expect(labels.length).toBeGreaterThan(0)
    // Why unique: cmd jumps to the first match, so a duplicated label silently reroutes control.
    expect(new Set(labels).size).toBe(labels.length)
    for (const target of new Set(targets)) {
      expect(labels).toContain(target)
    }
  })

  it('balances setlocal against endlocal', () => {
    const opened = lines.filter((line) => line.startsWith('setlocal')).length
    const closed = lines.filter((line) => line === 'endlocal').length
    // Why one stays open: the outer scope is torn down by `exit /b`, and the POST path below
    // endlocal deliberately reads plain %VARS% set before delayed expansion was enabled.
    expect(opened).toBe(2)
    expect(closed).toBe(1)
    expect(script.indexOf('setlocal enabledelayedexpansion')).toBeLessThan(
      script.indexOf('echo(!ORCA_STATUSLINE_LINE!')
    )
  })

  it('spawns nothing but the stdin reader on the render path', () => {
    const renderPath = sliceBetween('more.com', 'echo(!ORCA_STATUSLINE_LINE!')
    const spawns = [...renderPath.matchAll(/[\w%\\.-]*\.(?:exe|com|bat|cmd)\b/gi)].map((match) =>
      match[0].split('\\').pop()
    )
    // Why: the render runs on every tick — findstr and curl belong to the POST path only.
    expect(spawns).toEqual(['more.com'])
  })

  it('prints before the rate_limits guard and before the throttle', () => {
    const printIndex = script.indexOf('echo(!ORCA_STATUSLINE_LINE!')
    const stampIndex = script.indexOf('ORCA_STATUSLINE_STAMP_FILE=')
    const findstrIndex = script.indexOf('findstr.exe')
    expect(printIndex).toBeGreaterThan(-1)
    expect(printIndex).toBeLessThan(stampIndex)
    expect(printIndex).toBeLessThan(findstrIndex)
  })

  it('bounds each rate-limit window at its own first brace before reading a percentage', () => {
    for (const window of ['five_hour', 'seven_day']) {
      const block = sliceBetween(
        `set "ORCA_STATUSLINE_WINDOW=!ORCA_STATUSLINE_LIMITS:*"${window}"=!"`,
        `set "ORCA_STATUSLINE_${window === 'five_hour' ? 'FIVE' : 'SEVEN'}=!ORCA_STATUSLINE_VALUE!"`
      )
      const braceIndex = block.indexOf('for /f "delims=}"')
      const percentIndex = block.indexOf(':*,used_percentage,=')
      // Why the order matters: both windows carry used_percentage, so a window that omits its
      // own would borrow its sibling's the moment the scope is not closed first.
      expect(braceIndex).toBeGreaterThan(-1)
      expect(percentIndex).toBeGreaterThan(braceIndex)
    }
  })

  it('never renders a percentage it could not parse', () => {
    // Why: a false 0% reads as real data. Both quota fields and ctx clear on any non-digit.
    const clears = script.match(/for \/f "delims=0123456789"/g) ?? []
    // Four percentages, the trend baseline read back from the per-pane file, and the
    // COLUMNS width-budget guard.
    expect(clears.length).toBe(6)
    // An unparsed value skips its own composition block and lands on the next one.
    expect(script).toMatch(/if not defined ORCA_STATUSLINE_FIVE goto :orca_statusline_item_\d+/)
    expect(script).toMatch(/if not defined ORCA_STATUSLINE_SEVEN goto :orca_statusline_item_\d+/)
  })

  it('keys the account cache on the config dir name and reads the vault at most once', () => {
    expect(script).toContain(
      'for %%d in ("!ORCA_STATUSLINE_ACCT_DIR!") do set "ORCA_STATUSLINE_ACCT_KEY=%%~nxd"'
    )
    expect(script).toContain(
      'set "ORCA_STATUSLINE_ACCT_CACHE=%TEMP%\\orca-claude-statusline-acct-!ORCA_STATUSLINE_ACCT_KEY!.tmp"'
    )
    const cacheReadIndex = script.indexOf('set /p ORCA_STATUSLINE_ACCOUNT=<')
    const vaultReadIndex = script.indexOf('oauth-account.json')
    expect(cacheReadIndex).toBeGreaterThan(-1)
    expect(cacheReadIndex).toBeLessThan(vaultReadIndex)
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_ACCOUNT goto :orca_statusline_account_render'
    )
    // Why the whole file: the vault ships pretty-printed, so emailAddress is never on line 1.
    expect(script).toContain(
      'for /f "usebackq delims=" %%a in ("!ORCA_STATUSLINE_VAULT!") do set "ORCA_STATUSLINE_ACCT_RAW=!ORCA_STATUSLINE_ACCT_RAW!%%a"'
    )
  })

  it('never writes an empty account into the cache', () => {
    // Why: `echo` with an empty variable writes "ECHO is off." — which would then be the
    // permanent label for that account, since the cache is keyed per account under %TEMP%.
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_ACCOUNT (>"!ORCA_STATUSLINE_ACCT_CACHE!" echo !ORCA_STATUSLINE_ACCOUNT!)'
    )
  })

  it('announces the identity once per pane from a marker separate from the post stamp', () => {
    expect(script).toContain('set "ORCA_STATUSLINE_INTRO=Orca by Ab2Web"')
    expect(script).toContain(
      'set "ORCA_STATUSLINE_INTRO_STAMP=%TEMP%\\orca-claude-statusline-intro-!ORCA_STATUSLINE_INTRO_KEY!.tmp"'
    )
    expect(script).toContain(
      'if exist "!ORCA_STATUSLINE_INTRO_STAMP!" goto :orca_statusline_compose'
    )
    // Why the pane-key gate: the orphan id carries %RANDOM%, so reusing it would strobe the banner.
    expect(script).toContain(
      'if defined ORCA_PANE_KEY set "ORCA_STATUSLINE_INTRO_KEY=!ORCA_STATUSLINE_PANE_ID!"'
    )
    expect(script).toContain(
      'if not defined ORCA_STATUSLINE_INTRO_KEY goto :orca_statusline_compose'
    )
    // Why distinct files: the post stamp governs the network, this one governs the render.
    expect(script).not.toContain('orca-claude-statusline-intro-%ORCA_STATUSLINE_PANE_ID%')
  })

  it('admits the optional fields in priority order under one width budget', () => {
    const accountIndex = script.indexOf('set "ORCA_STATUSLINE_NEXT=@!ORCA_STATUSLINE_ACCOUNT!"')
    // %% is how a literal percent sign is written in a batch file.
    const fiveIndex = script.indexOf(
      'set "ORCA_STATUSLINE_NEXT=5h !ORCA_STATUSLINE_FIVE_BAR! !ORCA_STATUSLINE_FIVE!%%"'
    )
    const sevenIndex = script.indexOf(
      'set "ORCA_STATUSLINE_NEXT=7d !ORCA_STATUSLINE_SEVEN_BAR! !ORCA_STATUSLINE_SEVEN!%%"'
    )
    // Why the countdown is last: it is context on top of the level, never worth the weekly quota.
    const resetIndex = script.indexOf(
      `set "ORCA_STATUSLINE_NEXT=${STATUSLINE_RESET_MARK_ASCII} !ORCA_STATUSLINE_RESET!"`
    )
    expect(accountIndex).toBeGreaterThan(-1)
    expect(fiveIndex).toBeGreaterThan(accountIndex)
    expect(sevenIndex).toBeGreaterThan(fiveIndex)
    expect(resetIndex).toBeGreaterThan(sevenIndex)
    // Why a sticky flag, not goto :emit: admitting a shorter field behind one that did not fit
    // inverts priority, but identity fields ordered after a budgeted one must still print.
    const overflow = script.match(
      /for \/f %%w in \("!ORCA_STATUSLINE_BUDGET!"\) do if not "!ORCA_STATUSLINE_NEXT:~%%w!"=="" set "ORCA_STATUSLINE_FULL=1"/g
    )
    expect(overflow?.length).toBe(4)
    const fullGuards = script.match(/if defined ORCA_STATUSLINE_FULL goto :/g)
    expect(fullGuards?.length).toBe(8)
    expect(script).not.toContain('goto :orca_statusline_emit"')
    // Why no trailing @: the leading sigil in the rendered field already marks the account, and
    // 18 + "..." keeps the same 21-column bound the POSIX branch's 20 + "…" produces.
    expect(script).toContain('set "ORCA_STATUSLINE_ACCOUNT=!ORCA_STATUSLINE_ACCOUNT:~0,18!..."')
    expect(script).not.toContain('...@')
  })

  it('resolves the width budget from COLUMNS before the composition runs', () => {
    // Why the leading-zero rejection: cmd's numeric IF parses it as octal ("08" even falls back
    // to string comparison), so the grammar drops it and keeps the assumed 96 (POSIX parity).
    const budgetIndex = script.indexOf('set "ORCA_STATUSLINE_BUDGET=96"')
    expect(budgetIndex).toBeGreaterThan(-1)
    expect(script).toContain('if defined COLUMNS set "ORCA_STATUSLINE_COLS=!COLUMNS!"')
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_COLS for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_COLS!") do set "ORCA_STATUSLINE_COLS="'
    )
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_COLS if "!ORCA_STATUSLINE_COLS:~0,1!"=="0" set "ORCA_STATUSLINE_COLS="'
    )
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_COLS if not "!ORCA_STATUSLINE_COLS:~4!"=="" set "ORCA_STATUSLINE_COLS="'
    )
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_COLS if !ORCA_STATUSLINE_COLS! LSS 96 set "ORCA_STATUSLINE_BUDGET=!ORCA_STATUSLINE_COLS!"'
    )
    const composeIndex = script.indexOf('set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_INTRO!"')
    expect(budgetIndex).toBeLessThan(composeIndex)
    // No baked-in overflow test survives: every budget check reads the runtime variable.
    expect(script).not.toContain(':~96!')
  })

  it('renders the composition in the configured order', () => {
    const ordered = getWindowsManagedStatusLineScript(undefined, [
      'model',
      'project',
      'context',
      'resetCountdown',
      'account',
      'fiveHourQuota',
      'sevenDayQuota',
      'cost'
    ])
    const compose = ordered.slice(
      ordered.indexOf('set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_INTRO!"')
    )
    const modelIndex = compose.indexOf('if defined ORCA_STATUSLINE_MODEL')
    const projectIndex = compose.indexOf('if defined ORCA_STATUSLINE_PROJECT')
    const resetIndex = compose.indexOf(
      `set "ORCA_STATUSLINE_NEXT=${STATUSLINE_RESET_MARK_ASCII} !ORCA_STATUSLINE_RESET!"`
    )
    const accountIndex = compose.indexOf('set "ORCA_STATUSLINE_NEXT=@!ORCA_STATUSLINE_ACCOUNT!"')
    expect(modelIndex).toBeGreaterThan(-1)
    expect(projectIndex).toBeGreaterThan(modelIndex)
    expect(resetIndex).toBeGreaterThan(projectIndex)
    expect(accountIndex).toBeGreaterThan(resetIndex)
  })

  it('slices every bar out of one table that matches the POSIX one cell for cell', () => {
    // Why compare the two alphabets and not just the batch: the glyphs diverge because cmd reads
    // this file in the OEM codepage, but the levels must not — a pane that shows three filled
    // cells on macOS has to show three on Windows.
    const asciiLevels = statuslineBarLevelsAscii(DEFAULT_BAR_CELLS)
    const unicodeLevels = statuslineBarLevelsUnicode(DEFAULT_BAR_CELLS)
    expect(asciiLevels).toHaveLength(unicodeLevels.length)
    for (const [level, ascii] of asciiLevels.entries()) {
      expect([...ascii]).toHaveLength(DEFAULT_BAR_CELLS)
      expect(ascii.replaceAll('#', '█').replaceAll('=', '▌').replaceAll('.', '░')).toBe(
        unicodeLevels[level]
      )
    }
    expect(script).toContain(`set "ORCA_STATUSLINE_BARS=${asciiLevels.join('')}"`)
    // Why the for-variable offset: a %VAR% offset is expanded at parse time and would still hold
    // the previous tick's value, while a for-variable resolves before delayed expansion.
    for (const target of ['CTX', 'FIVE', 'SEVEN']) {
      expect(script).toContain(
        `for %%o in (!ORCA_STATUSLINE_OFFSET!) do set "ORCA_STATUSLINE_${target}_BAR=!ORCA_STATUSLINE_BARS:~%%o,${DEFAULT_BAR_CELLS}!"`
      )
      expect(script).toContain(
        `if defined ORCA_STATUSLINE_${target} set /a "ORCA_STATUSLINE_LEVEL=ORCA_STATUSLINE_${target}/10" 2>nul`
      )
    }
  })

  it('never lets the trend compare a negative, and invents no direction without a baseline', () => {
    // Why the larger side is taken first: cmd's IF falls back to a string compare the moment
    // either operand is not all digits, so a negative delta would silently mis-order.
    const riseIndex = script.indexOf(
      'if !ORCA_STATUSLINE_CTX! GTR !ORCA_STATUSLINE_PREV! goto :orca_statusline_trend_rise'
    )
    const fallIndex = script.indexOf(
      'if !ORCA_STATUSLINE_PREV! GTR !ORCA_STATUSLINE_CTX! goto :orca_statusline_trend_fall'
    )
    expect(riseIndex).toBeGreaterThan(-1)
    expect(fallIndex).toBeGreaterThan(riseIndex)
    expect(script).toContain(
      'set /a "ORCA_STATUSLINE_DELTA=ORCA_STATUSLINE_CTX-ORCA_STATUSLINE_PREV" 2>nul'
    )
    expect(script).toContain(
      'set /a "ORCA_STATUSLINE_DELTA=ORCA_STATUSLINE_PREV-ORCA_STATUSLINE_CTX" 2>nul'
    )
    const thresholds =
      script.match(
        new RegExp(
          `if !ORCA_STATUSLINE_DELTA! LSS ${STATUSLINE_TREND_THRESHOLD} goto :orca_statusline_trend_done`,
          'g'
        )
      ) ?? []
    expect(thresholds).toHaveLength(2)
    // A missing baseline records one and claims nothing — the arrow slot stays empty.
    const emptyIndex = script.indexOf('set "ORCA_STATUSLINE_TREND="')
    const skipIndex = script.indexOf(
      'if not defined ORCA_STATUSLINE_PREV goto :orca_statusline_trend_write'
    )
    const steadyIndex = script.indexOf(
      `set "ORCA_STATUSLINE_TREND=${STATUSLINE_TREND_ASCII.steady}"`
    )
    expect(emptyIndex).toBeGreaterThan(-1)
    expect(skipIndex).toBeGreaterThan(emptyIndex)
    expect(steadyIndex).toBeGreaterThan(skipIndex)
    // Why a file separate from the post stamp and the banner marker: this one tracks the render.
    expect(script).toContain(
      'set "ORCA_STATUSLINE_TREND_FILE=%TEMP%\\orca-claude-statusline-ctx-!ORCA_STATUSLINE_INTRO_KEY!.tmp"'
    )
  })

  it('reads the reset countdown from the same per-account file the POSIX branch does', () => {
    expect(script).toContain(
      'set "ORCA_STATUSLINE_RESET_FILE=%TEMP%\\orca-claude-statusline-reset-!ORCA_STATUSLINE_RESET_KEY!.tmp"'
    )
    // Why the same fallback name: a session with no CLAUDE_CONFIG_DIR must find the file Orca
    // wrote for the system-default account, on either OS.
    expect(script).toContain(
      'if not defined ORCA_STATUSLINE_RESET_KEY set "ORCA_STATUSLINE_RESET_KEY=system-default"'
    )
    // Why the pane-key gate: outside Orca nothing refreshes that file, so it could be days old.
    expect(script).toContain('if not defined ORCA_PANE_KEY goto :orca_statusline_reset_done')
    // Why the allow-list: this file is the one place arbitrary text could reach the user's line.
    expect(script).toContain(
      'if defined ORCA_STATUSLINE_RESET for /f "delims=0123456789dhm" %%r in ("!ORCA_STATUSLINE_RESET!") do set "ORCA_STATUSLINE_RESET="'
    )
    expect(script).toContain(
      `if defined ORCA_STATUSLINE_RESET if not "!ORCA_STATUSLINE_RESET:~${STATUSLINE_RESET_MAX_CHARS}!"=="" set "ORCA_STATUSLINE_RESET="`
    )
    // The read happens on the render path, so it must stay builtin-only.
    const renderPath = sliceBetween('set "ORCA_STATUSLINE_RESET="', 'echo(!ORCA_STATUSLINE_LINE!')
    expect(renderPath).not.toMatch(/\.(?:exe|com|bat|cmd)\b/i)
  })

  it('marks the countdown with an ASCII glyph no other field already means', () => {
    // Why not `+ - ~`: those already mean a direction on this line, and `↻` would arrive as
    // mojibake through the OEM codepage — the same trade the `…` vs `...` elision makes.
    expect(STATUSLINE_RESET_MARK_ASCII).toBe('>')
    expect(Object.values(STATUSLINE_TREND_ASCII)).not.toContain(STATUSLINE_RESET_MARK_ASCII)
    expect(statuslineBarLevelsAscii(DEFAULT_BAR_CELLS).join('')).not.toContain(
      STATUSLINE_RESET_MARK_ASCII
    )
    // Why it can be a redirection character at all: every line that embeds it keeps it inside a
    // fully quoted `set`, and it reaches stdout through delayed expansion, which cmd does not
    // re-parse for redirection.
    const markLines = lines.filter((entry) =>
      entry.includes(`${STATUSLINE_RESET_MARK_ASCII} !ORCA_STATUSLINE_RESET!`)
    )
    expect(markLines).toHaveLength(2)
    for (const line of markLines) {
      expect(line).toMatch(/set "ORCA_STATUSLINE_NEXT=[^"]*"$/)
    }
  })

  it('carries no credential material onto the line', () => {
    expect(script).not.toMatch(/accessToken|refreshToken|apiKey|sessionKey/i)
    expect(script).toContain('"emailAddress"')
  })

  it('renders the batch as ASCII so the OEM codepage cannot garble the line', () => {
    // Why: writeManagedScript emits UTF-8 while cmd reads the file in the console codepage,
    // so POSIX's "…" elision would arrive as mojibake. Every byte here stays single-byte.
    expect(Buffer.byteLength(script, 'utf8')).toBe(script.length)
  })
})

// Why gated: cmd.exe exists only on Windows, and `pr.yml` runs this suite on ubuntu — so these
// assertions cover a Windows developer's machine, not CI. They are not evidence of CI coverage.
describe.skipIf(process.platform !== 'win32')('getWindowsManagedStatusLineScript (stdout)', () => {
  const PANE_KEY = 'tab-1:00000000-0000-4000-8000-000000000000'
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeHarness(): { scriptPath: string; temp: string } {
    const dir = mkdtempSync(join(tmpdir(), 'orca-statusline-win-'))
    dirs.push(dir)
    const temp = join(dir, 'temp')
    mkdirSync(temp, { recursive: true })
    const scriptPath = join(dir, 'statusline.bat')
    writeFileSync(scriptPath, script)
    return { scriptPath, temp }
  }

  function displayPayload(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      model: { id: 'claude-fable-5', display_name: 'Fable' },
      cost: { total_duration_ms: 1_000 },
      context_window: { used_percentage: 42.7, remaining_percentage: 57.3 },
      ...overrides
    })
  }

  // Why no stubbed binaries: the script calls findstr/curl by absolute %SystemRoot% path, so the
  // post is suppressed by leaving the hook port and token unset instead.
  function runScript(
    scriptPath: string,
    temp: string,
    payload: string,
    configDir?: string,
    columns?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/c', scriptPath], {
        env: {
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          ComSpec: process.env.ComSpec ?? 'cmd.exe',
          PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
          TEMP: temp,
          TMP: temp,
          ORCA_PANE_KEY: PANE_KEY,
          ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
          ...(columns === undefined ? {} : { COLUMNS: columns })
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

  function makeVault(email: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'orca-statusline-vault-'))
    dirs.push(dir)
    const configDir = join(dir, 'claude-accounts', 'acct-1234', 'auth')
    mkdirSync(configDir, { recursive: true })
    // Pretty-printed on purpose: that is how the vault ships on disk.
    writeFileSync(
      join(configDir, 'oauth-account.json'),
      JSON.stringify({ accountUuid: 'u', emailAddress: email, displayName: 'Sam' }, null, 2)
    )
    return configDir
  }

  it('prints identity, model and context for a payload without rate_limits', async () => {
    const { scriptPath, temp } = makeHarness()
    const stdout = await runScript(scriptPath, temp, displayPayload())
    expect(stdout).toBe('Orca by Ab2Web | Fable | ctx ##... 42%\r\n')
  })

  it('prints both quota windows alongside the account', async () => {
    const { scriptPath, temp } = makeHarness()
    const configDir = makeVault('sam.rivera@example.com')
    const stdout = await runScript(
      scriptPath,
      temp,
      displayPayload({
        rate_limits: { five_hour: { used_percentage: 29 }, seven_day: { used_percentage: 81 } }
      }),
      configDir
    )
    // Why exactly one @: the leading sigil already marks the account; the elision's trailing @
    // stacked onto it read as a bug (@user@) on every user's line.
    expect(stdout).toBe(
      'Orca by Ab2Web | Fable | ctx ##... 42% | @sam.rivera | 5h #.... 29% | 7d ####. 81%\r\n'
    )
    expect(stdout).not.toContain('rivera@')
  })

  it('announces the identity once per pane and keeps printing after', async () => {
    const { scriptPath, temp } = makeHarness()
    const payload = displayPayload({ rate_limits: { five_hour: { used_percentage: 12 } } })
    const first = await runScript(scriptPath, temp, payload)
    const second = await runScript(scriptPath, temp, payload)
    expect(first).toBe('Orca by Ab2Web | Fable | ctx ##... 42% | 5h =.... 12%\r\n')
    // Why the arrow only appears on the second tick: the first one had no baseline to compare to.
    expect(second).toBe('Fable | ctx ##... 42% ~ | 5h =.... 12%\r\n')
  })

  it('reads the vault once and serves the account from the cache after', async () => {
    const { scriptPath, temp } = makeHarness()
    const configDir = makeVault('first@example.com')
    await runScript(scriptPath, temp, displayPayload(), configDir)
    writeFileSync(
      join(configDir, 'oauth-account.json'),
      JSON.stringify({ emailAddress: 'second@example.com' }, null, 2)
    )
    const cached = await runScript(scriptPath, temp, displayPayload(), configDir)
    expect(cached).toContain('@first')
    expect(cached).not.toContain('first@')
    expect(cached).not.toContain('second')
  })

  it('keeps a window whose sibling omits used_percentage from borrowing the value', async () => {
    const { scriptPath, temp } = makeHarness()
    const stdout = await runScript(
      scriptPath,
      temp,
      displayPayload({
        rate_limits: { five_hour: { resets_at: 'later' }, seven_day: { used_percentage: 81 } }
      })
    )
    expect(stdout).toBe('Orca by Ab2Web | Fable | ctx ##... 42% | 7d ####. 81%\r\n')
    expect(stdout).not.toContain('5h')
  })

  it('never renders a rate-limit percentage as context usage', async () => {
    const { scriptPath, temp } = makeHarness()
    const stdout = await runScript(
      scriptPath,
      temp,
      JSON.stringify({
        model: { id: 'claude-fable-5', display_name: 'Fable' },
        rate_limits: { five_hour: { used_percentage: 12 } }
      })
    )
    expect(stdout).toBe('Orca by Ab2Web | Fable | 5h =.... 12%\r\n')
  })

  it('falls back to model.id when display_name is absent', async () => {
    const { scriptPath, temp } = makeHarness()
    const stdout = await runScript(
      scriptPath,
      temp,
      JSON.stringify({
        model: { id: 'claude-fable-5' },
        context_window: { used_percentage: 42.7 }
      })
    )
    expect(stdout).toBe('Orca by Ab2Web | claude-fable-5 | ctx ##... 42%\r\n')
  })

  it('bounds a long address instead of letting it push quota off the line', async () => {
    const { scriptPath, temp } = makeHarness()
    const configDir = makeVault(`${'a'.repeat(60)}@example.com`)
    const stdout = await runScript(
      scriptPath,
      temp,
      displayPayload({
        rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 45 } }
      }),
      configDir
    )
    expect(stdout.trimEnd().length).toBeLessThanOrEqual(96)
    expect(stdout).toContain('5h =.... 12%')
    expect(stdout).toContain('7d ##... 45%')
    expect(stdout).not.toContain('a'.repeat(30))
  })

  it('budgets against COLUMNS on a narrow viewport: identity stays, the ladder falls', async () => {
    const { scriptPath, temp } = makeHarness()
    const payload = displayPayload({
      rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 45 } }
    })
    // banner(14) + " | Fable"(8) + " | ctx ##... 42%"(16) = 38 fits 40; every quota bar falls.
    const narrow = await runScript(scriptPath, temp, payload, undefined, '40')
    expect(narrow).toBe('Orca by Ab2Web | Fable | ctx ##... 42%\r\n')
    expect(narrow.trimEnd().length).toBeLessThanOrEqual(40)
  })

  it('treats a malformed or huge COLUMNS as the assumed 96-column budget', async () => {
    const { scriptPath, temp } = makeHarness()
    const payload = displayPayload({
      rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 45 } }
    })
    // Prime the pane: the banner shows once and the trend baseline exists from here on.
    await runScript(scriptPath, temp, payload)
    // "040" is the octal trap in cmd numeric IF; "200" must clamp to the 96 ceiling.
    for (const columns of ['040', '40x', '0', '200']) {
      const stdout = await runScript(scriptPath, temp, payload, undefined, columns)
      expect(stdout).toBe('Fable | ctx ##... 42% ~ | 5h =.... 12% | 7d ##... 45%\r\n')
    }
  })
})
