// Behavioral coverage for the Settings-chosen item set: which fields render, how the freed
// columns grow the bars, and that the project never falls first on a narrow line.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ClaudeStatusLineItemKey,
  ClaudeStatusLineItems
} from '../../shared/claude-statusline-items'
import { getManagedStatusLineScript } from './statusline-script'

describe.skipIf(process.platform === 'win32')('statusline items (posix behavioral)', () => {
  const PANE_KEY = 'tab-1:00000000-0000-4000-8000-000000000000'
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function displayPayload(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      model: { id: 'claude-fable-5', display_name: 'Fable' },
      workspace: { current_dir: '/tmp/x', project_dir: '/tmp/x' },
      cost: { total_duration_ms: 1_000 },
      context_window: { used_percentage: 42.7, remaining_percentage: 57.3 },
      ...overrides
    })
  }

  function makeHarness(
    items?: Partial<ClaudeStatusLineItems>,
    order?: readonly ClaudeStatusLineItemKey[]
  ): {
    scriptPath: string
    dir: string
  } {
    const dir = mkdtempSync(join(tmpdir(), 'orca-statusline-items-'))
    dirs.push(dir)
    const scriptPath = join(dir, 'statusline.sh')
    writeFileSync(scriptPath, getManagedStatusLineScript('posix', items, order))
    return { scriptPath, dir }
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
          PATH: process.env.PATH ?? '',
          TMPDIR: dir,
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

  // Why code points and not `.length`: the budget is a column budget, and a bar cell is one column.
  function columns(line: string): number {
    return [...line.trimEnd()].length
  }

  it('truncates a long project name instead of letting it blow the line', async () => {
    const { scriptPath, dir } = makeHarness()
    const stdout = await runScript(
      scriptPath,
      dir,
      displayPayload({
        workspace: {
          current_dir: '/tmp/w',
          project_dir: '/Users/dev/orca-102-statusline-configurable'
        }
      }),
      'tab-1:project-long'
    )
    expect(stdout.trimEnd()).toBe(
      'Orca by Ab2Web · orca-102-statusline-con… · Fable · ctx ██░░░ 42%'
    )
  })

  it('leaves the project out when the item is turned off', async () => {
    const { scriptPath, dir } = makeHarness({ project: false })
    const stdout = await runScript(scriptPath, dir, displayPayload(), 'tab-1:project-off')
    expect(stdout.trimEnd()).toBe('Orca by Ab2Web · Fable · ctx ██░░░ 42%')
  })

  it('keeps the project on a narrow line while quota falls', async () => {
    // Why: hiding the project first in narrow panes was the reported defect — it now sits in
    // the fixed prefix, so the ladder pays with quota fields instead.
    const payload = displayPayload({
      model: { id: 'm', display_name: 'Claude Opus 5 (1M context) preview build 2026' },
      workspace: { current_dir: '/tmp/w', project_dir: '/tmp/orca-102-statusline-configurable' },
      context_window: { used_percentage: 93 },
      rate_limits: { five_hour: { used_percentage: 88 }, seven_day: { used_percentage: 77 } }
    })
    const { scriptPath, dir } = makeHarness()
    await runScript(scriptPath, dir, payload, 'tab-1:narrow-project')
    const stdout = await runScript(scriptPath, dir, payload, 'tab-1:narrow-project')
    expect(columns(stdout)).toBeLessThanOrEqual(96)
    expect(stdout).toContain('orca-102-statusline-con…')
    expect(stdout).toContain('ctx ████▌ 93%')
  })

  it('renders the session cost only when the item is enabled, truncated to cents', async () => {
    const { scriptPath, dir } = makeHarness({ cost: true })
    const stdout = await runScript(
      scriptPath,
      dir,
      displayPayload({ cost: { total_cost_usd: 0.27877651, total_duration_ms: 1_000 } }),
      'tab-1:cost-on'
    )
    expect(stdout.trimEnd()).toBe('Orca by Ab2Web · x · Fable · ctx ██░░░ 42% · $0.27')
    const integer = await runScript(
      scriptPath,
      dir,
      displayPayload({ cost: { total_cost_usd: 12, total_duration_ms: 1_000 } }),
      'tab-1:cost-int'
    )
    expect(integer.trimEnd()).toBe('Orca by Ab2Web · x · Fable · ctx ██░░░ 42% · $12')
    const hiddenHarness = makeHarness()
    const hidden = await runScript(
      hiddenHarness.scriptPath,
      hiddenHarness.dir,
      displayPayload({ cost: { total_cost_usd: 0.27877651, total_duration_ms: 1_000 } }),
      'tab-1:cost-off'
    )
    expect(hidden).not.toContain('$')
  })

  it('renders no cost it could not parse', async () => {
    const { scriptPath, dir } = makeHarness({ cost: true })
    // Why: JSON serializes tiny floats in scientific notation, and "5e-7" must never read as $5.
    const sci = await runScript(
      scriptPath,
      dir,
      displayPayload({ cost: { total_cost_usd: 5e-7, total_duration_ms: 1_000 } }),
      'tab-1:cost-sci'
    )
    expect(sci).not.toContain('$')
  })

  it('grows the bars into columns freed by turning items off', async () => {
    // Reset countdown off frees 11 columns with project off costing none: 3 extra per bar.
    const { scriptPath, dir } = makeHarness({ project: false, resetCountdown: false })
    const stdout = await runScript(
      scriptPath,
      dir,
      displayPayload({ rate_limits: { five_hour: { used_percentage: 12 } } }),
      'tab-1:bars-8'
    )
    expect(stdout.trimEnd()).toBe('Orca by Ab2Web · Fable · ctx ███░░░░░ 42% · 5h ▌░░░░░░░ 12%')
    // Dropping the weekly quota too frees 27 columns over two bars: the 10-cell cap.
    const wide = makeHarness({ project: false, resetCountdown: false, sevenDayQuota: false })
    const widest = await runScript(
      wide.scriptPath,
      wide.dir,
      displayPayload({ rate_limits: { five_hour: { used_percentage: 12 } } }),
      'tab-1:bars-10'
    )
    expect(widest.trimEnd()).toBe('Orca by Ab2Web · Fable · ctx ████░░░░░░ 42% · 5h █░░░░░░░░░ 12%')
  })

  it('honors turning the model and account off', async () => {
    const { scriptPath, dir } = makeHarness({ model: false, account: false })
    const configDir = join(dir, 'claude-accounts', 'acct-off', 'auth')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'oauth-account.json'),
      JSON.stringify({ emailAddress: 'sam.rivera@example.com' })
    )
    const stdout = await runScript(scriptPath, dir, displayPayload(), PANE_KEY, configDir)
    expect(stdout.trimEnd()).toBe('Orca by Ab2Web · x · ctx ██░░░ 42%')
    expect(stdout).not.toContain('@')
    expect(stdout).not.toContain('Fable')
  })

  it('renders no reset countdown when the item is off', async () => {
    const { scriptPath, dir } = makeHarness({ resetCountdown: false, project: false })
    writeFileSync(join(dir, 'orca-claude-statusline-reset-system-default'), '2d4h\n')
    const stdout = await runScript(
      scriptPath,
      dir,
      displayPayload({ rate_limits: { five_hour: { used_percentage: 37 } } }),
      'tab-1:reset-item-off'
    )
    expect(stdout).not.toContain('↻')
    expect(stdout).toContain('5h')
  })

  it('renders the fields in the configured order', async () => {
    const { scriptPath, dir } = makeHarness({ cost: true }, [
      'model',
      'project',
      'context',
      'cost',
      'sevenDayQuota',
      'fiveHourQuota',
      'account',
      'resetCountdown'
    ])
    const stdout = await runScript(
      scriptPath,
      dir,
      displayPayload({
        cost: { total_cost_usd: 1.5, total_duration_ms: 1_000 },
        rate_limits: { five_hour: { used_percentage: 63 }, seven_day: { used_percentage: 31 } }
      }),
      'tab-1:item-order'
    )
    expect(stdout.trimEnd()).toBe(
      'Orca by Ab2Web · Fable · x · ctx ██░░░ 42% · $1.50 · 7d █▌░░░ 31% · 5h ███░░ 63%'
    )
  })
})
