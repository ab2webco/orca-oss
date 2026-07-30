// Parity contract between the Settings preview (`composeStatusLine`) and the scripts users
// actually run: the POSIX cases execute the generated sh against the preview's sample payload
// with every cache primed to the sample values, then require byte-identical output. The preview
// never executes the script in the app — this suite is what keeps the TS composition honest.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeClaudeStatusLineItemOrder,
  normalizeClaudeStatusLineItems,
  type ClaudeStatusLineItemKey,
  type ClaudeStatusLineItems
} from '../../shared/claude-statusline-items'
import {
  CLAUDE_STATUSLINE_PREVIEW_SAMPLE,
  composeStatusLine,
  deriveStatusLineBarCells,
  resolveStatusLineWidthBudget,
  statuslineBarLevelsAscii
} from '../../shared/claude-statusline-line-model'
import { getManagedStatusLineScript } from './statusline-script'
import { getWindowsManagedStatusLineScript } from './statusline-script-windows'
import { windowsGaugeTableLine } from './statusline-usage-gauge'

const PANE_UUID = '00000000-0000-4000-8000-000000000000'
const PANE_KEY = `tab-1:${PANE_UUID}`
const ACCOUNT_KEY = 'acct-parity'

function samplePayload(): string {
  const sample = CLAUDE_STATUSLINE_PREVIEW_SAMPLE
  return JSON.stringify({
    model: { id: 'claude-fable-5', display_name: sample.model },
    workspace: { current_dir: sample.projectDir, project_dir: sample.projectDir },
    cost: { total_cost_usd: sample.totalCostUsd, total_duration_ms: 1_000 },
    context_window: { used_percentage: sample.contextPercent },
    rate_limits: {
      five_hour: { used_percentage: sample.fiveHourPercent },
      seven_day: { used_percentage: sample.sevenDayPercent }
    }
  })
}

describe.skipIf(process.platform === 'win32')('statusline preview parity (posix)', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Prime every cache the script reads so its steady-state tick renders exactly the sample:
  // intro stamp (banner already shown), trend baseline (sample delta = rising), account cache
  // (sample email) and reset countdown file (sample value).
  function makeSteadyStateHarness(
    items?: Partial<ClaudeStatusLineItems>,
    order?: readonly ClaudeStatusLineItemKey[]
  ): { scriptPath: string; dir: string; configDir: string } {
    const sample = CLAUDE_STATUSLINE_PREVIEW_SAMPLE
    const dir = mkdtempSync(join(tmpdir(), 'orca-statusline-parity-'))
    dirs.push(dir)
    const scriptPath = join(dir, 'statusline.sh')
    writeFileSync(scriptPath, getManagedStatusLineScript('posix', items, order))
    const configDir = join(dir, 'accounts', ACCOUNT_KEY, 'auth')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(dir, `orca-claude-statusline-intro-${PANE_UUID}`), '')
    writeFileSync(
      join(dir, `orca-claude-statusline-ctx-${PANE_UUID}`),
      String(sample.contextPercent - 2)
    )
    writeFileSync(join(dir, `orca-claude-statusline-acct-${ACCOUNT_KEY}`), sample.accountEmail)
    writeFileSync(join(dir, `orca-claude-statusline-reset-${ACCOUNT_KEY}`), sample.resetCountdown)
    return { scriptPath, dir, configDir }
  }

  function runScript(
    scriptPath: string,
    dir: string,
    configDir: string,
    columns?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', [scriptPath], {
        env: {
          PATH: process.env.PATH ?? '',
          TMPDIR: dir,
          ORCA_PANE_KEY: PANE_KEY,
          CLAUDE_CONFIG_DIR: configDir,
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
      child.stdin.write(samplePayload())
      child.stdin.end()
    })
  }

  async function expectParity(
    items?: Partial<ClaudeStatusLineItems>,
    order?: readonly ClaudeStatusLineItemKey[],
    columns?: string
  ): Promise<string> {
    const { scriptPath, dir, configDir } = makeSteadyStateHarness(items, order)
    const stdout = await runScript(scriptPath, dir, configDir, columns)
    const composed = composeStatusLine(
      normalizeClaudeStatusLineItems(items),
      normalizeClaudeStatusLineItemOrder(order),
      'posix',
      CLAUDE_STATUSLINE_PREVIEW_SAMPLE,
      resolveStatusLineWidthBudget(columns)
    )
    expect(stdout.trimEnd()).toBe(composed)
    return stdout.trimEnd()
  }

  it('matches the script for the default items and order', async () => {
    await expectParity()
  })

  it('matches the script with cost on and account off', async () => {
    await expectParity({ cost: true, account: false })
  })

  it('matches the script when disabled items grow the bars', async () => {
    await expectParity({ account: false, sevenDayQuota: false, resetCountdown: false })
  })

  it('matches the script for a custom item order', async () => {
    await expectParity({ cost: true }, [
      'model',
      'project',
      'context',
      'resetCountdown',
      'cost',
      'sevenDayQuota',
      'fiveHourQuota',
      'account'
    ])
  })

  // The width cases are differential in both directions: each width byte-compares script vs
  // model independently, and the narrow lines are then checked against the wide one so a
  // budget that silently stopped dropping (or dropping too much) cannot pass as parity.
  it('matches the script at a narrow mobile width and drops the ladder tail', async () => {
    const wide = await expectParity()
    const narrow = await expectParity(undefined, undefined, '44')
    expect(narrow).not.toBe(wide)
    // 44 columns fit project · model · ctx · account, then the quota bars and countdown fall.
    expect(narrow).toContain('@alex')
    expect(narrow).not.toContain('5h')
    expect(narrow).not.toContain('7d')
    expect(wide).toContain('5h')
  })

  it('matches the script at a width where only the ladder tail falls', async () => {
    const mid = await expectParity(undefined, undefined, '60')
    expect(mid).toContain('5h')
    expect(mid).not.toContain('7d')
  })

  it('treats COLUMNS at or above the ceiling as the assumed width', async () => {
    const wide = await expectParity()
    expect(await expectParity(undefined, undefined, '96')).toBe(wide)
    expect(await expectParity(undefined, undefined, '200')).toBe(wide)
  })

  it('falls back to the assumed width on malformed COLUMNS', async () => {
    const wide = await expectParity()
    // Leading zeros are the octal trap on cmd; the grammar rejects them everywhere.
    for (const malformed of ['0', '040', '40x', 'abc', '']) {
      expect(await expectParity(undefined, undefined, malformed)).toBe(wide)
    }
  })
})

// cmd cannot execute here, so the Windows side pins the vocabulary the preview and the
// generator both derive from the shared line model — the structural suite in
// statusline-script-windows.test.ts covers the composition order and budget semantics.
describe('statusline preview parity (windows vocabulary)', () => {
  it('renders the bars the generated gauge table slices out', () => {
    const items = normalizeClaudeStatusLineItems(undefined)
    const order = normalizeClaudeStatusLineItemOrder(undefined)
    const cells = deriveStatusLineBarCells(items)
    const script = getWindowsManagedStatusLineScript()
    expect(script).toContain(windowsGaugeTableLine('ORCA_STATUSLINE_BARS', cells))
    const line = composeStatusLine(items, order, 'windows')
    const sample = CLAUDE_STATUSLINE_PREVIEW_SAMPLE
    const levels = statuslineBarLevelsAscii(cells)
    for (const percent of [sample.contextPercent, sample.fiveHourPercent, sample.sevenDayPercent]) {
      expect(line).toContain(levels[Math.floor(percent / 10)])
    }
    expect(line).toContain(' | ')
    expect(script).toContain(' | ')
  })
})
