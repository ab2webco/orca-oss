// A red packaged-watchdog smoke must say how long Electron ran and which phase it
// reached; the two ETIMEDOUT failures of 2026-10-22 (ORCA-751) printed neither.
import { describe, expect, it } from 'vitest'

import {
  formatSmokeFailure,
  formatSmokeSuccess,
  lastSmokePhase,
  smokePhaseLine,
  smokeSucceeded
} from './packaged-watchdog-smoke-report.mjs'

const timedOut = (stdout, stderr) => ({
  status: null,
  signal: 'SIGTERM',
  error: Object.assign(new Error('spawnSync electron ETIMEDOUT'), { code: 'ETIMEDOUT' }),
  stdout,
  stderr
})

describe('lastSmokePhase', () => {
  it('returns the last phase Electron printed', () => {
    const stdout = [smokePhaseLine('launched', 812), smokePhaseLine('ready', 1904), ''].join('\n')
    expect(lastSmokePhase(stdout)).toBe('ready t=1904ms')
  })

  it('returns null when Electron printed no phase', () => {
    expect(lastSmokePhase('')).toBeNull()
  })
})

const SUCCESS = '[packaged-watchdog-smoke] app.asar worker detected and recovered a stall'

describe('smokeSucceeded', () => {
  it('passes a clean exit that printed the success line', () => {
    expect(smokeSucceeded({ status: 0, stdout: `${SUCCESS}\n` }, SUCCESS)).toBe(true)
  })

  // Why: spawnSync's timeout sends SIGTERM and Electron quits gracefully with status 0,
  // so a status check alone reads a timed-out run as a clean exit.
  it('fails a timed-out run even when Electron exited 0 after printing success', () => {
    expect(smokeSucceeded({ ...timedOut(`${SUCCESS}\n`, ''), status: 0 }, SUCCESS)).toBe(false)
  })

  it('fails a clean exit that never printed the success line', () => {
    expect(smokeSucceeded({ status: 0, stdout: '' }, SUCCESS)).toBe(false)
  })
})

describe('formatSmokeFailure', () => {
  it('names a clean exit without the success line as such', () => {
    const message = formatSmokeFailure({
      result: { status: 0, signal: null, stdout: '', stderr: '' },
      elapsedMs: 900,
      budgetMs: 15_000
    })
    expect(message).toContain('(exit 0 without the success line)')
  })

  it('names the elapsed time, the budget and the last phase reached', () => {
    const message = formatSmokeFailure({
      result: timedOut(smokePhaseLine('ready', 1904), 'Xlib: extension "DPMS" missing\n'),
      elapsedMs: 15_012,
      budgetMs: 15_000
    })
    expect(message).toContain('ETIMEDOUT')
    expect(message).toContain('after 15012 ms of a 15000 ms budget')
    expect(message).toContain('last phase: ready t=1904ms')
    // Why both streams: the old `stderr || stdout` dropped stdout whenever Chromium
    // wrote anything to stderr, and stdout is where the phases are.
    expect(message).toContain('Xlib: extension "DPMS" missing')
    expect(message).toContain('[packaged-watchdog-smoke] phase=ready')
  })

  it('says Electron never reached the launcher when it printed nothing', () => {
    const message = formatSmokeFailure({
      result: timedOut('', ''),
      elapsedMs: 15_009,
      budgetMs: 15_000
    })
    expect(message).toContain('last phase: none')
  })
})

describe('formatSmokeSuccess', () => {
  it('records the launch time on green so the spread is readable from any run', () => {
    expect(formatSmokeSuccess({ elapsedMs: 4_211, budgetMs: 15_000 })).toBe(
      '[packaged-watchdog-smoke] electron exited after 4211 ms of a 15000 ms budget'
    )
  })
})
