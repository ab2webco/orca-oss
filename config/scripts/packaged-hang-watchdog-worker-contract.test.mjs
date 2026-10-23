import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

describe('packaged hang watchdog worker contract', () => {
  it('boots the worker from app.asar in PR checks', () => {
    const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
    const smokeSource = readFileSync(
      'config/scripts/smoke-packaged-hang-watchdog-worker.mjs',
      'utf8'
    )
    const smokeStep = workflow.jobs.package.steps.find(
      (step) => step.name === 'Smoke packaged hang watchdog worker'
    )

    expect(smokeStep.run).toBe(
      'xvfb-run --auto-servernum node config/scripts/smoke-packaged-hang-watchdog-worker.mjs --app-dir=dist/linux-unpacked'
    )
    expect(smokeSource).toContain(
      "process.platform === 'linux' ? ['--no-sandbox', launcherDir] : [launcherDir]"
    )
  })

  // Why: Electron ignores process.exitCode, so the gate needs app.exit plus a stdout assertion.
  it('fails the smoke when the packaged worker never reports success', () => {
    const smokeSource = readFileSync(
      'config/scripts/smoke-packaged-hang-watchdog-worker.mjs',
      'utf8'
    )

    expect(smokeSource).toContain('app.exit(1)')
    expect(smokeSource).not.toContain('app.quit()')
    expect(smokeSource).toContain('if (!smokeSucceeded(result, SUCCESS_LINE))')
  })

  // Why: the slowest healthy hosted-runner start on main measured 8693 ms (run 39880120548),
  // and two cold starts were killed at 15 s; keep at least 3x the slowest measured start.
  it('budgets the packaged worker spawn at least 3x the slowest measured cold start', () => {
    const smokeSource = readFileSync(
      'config/scripts/smoke-packaged-hang-watchdog-worker.mjs',
      'utf8'
    )
    const [, budget] = smokeSource.match(/const SPAWN_BUDGET_MS = ([\d_]+)/)
    const slowestMeasuredMs = 8693

    expect(Number(budget.replaceAll('_', ''))).toBeGreaterThanOrEqual(3 * slowestMeasuredMs)
  })
})
