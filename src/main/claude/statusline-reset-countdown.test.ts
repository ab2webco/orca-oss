import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatStatuslineResetCountdown,
  publishStatuslineResetCountdown,
  statuslineResetCountdownPath
} from './statusline-reset-countdown'

const NOW = 1_800_000_000_000
const ORIGINAL_ENV = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP }
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-statusline-reset-'))
  process.env.TMPDIR = dir
  process.env.TEMP = dir
  process.env.TMP = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

function fileFor(configDir: string | null): string {
  return readFileSync(statuslineResetCountdownPath(configDir), 'utf8').trim()
}

describe('formatStatuslineResetCountdown', () => {
  it('floors to the same units the usage roster uses, without the space', () => {
    // Why the same units: the roster shows "2d 4h" for this account; a status line that floored
    // differently would have the two surfaces disagreeing about the same window.
    expect(formatStatuslineResetCountdown(47 * 60_000)).toBe('47m')
    expect(formatStatuslineResetCountdown((3 * 60 + 54) * 60_000)).toBe('3h54m')
    expect(formatStatuslineResetCountdown(2 * 60 * 60_000)).toBe('2h')
    expect(formatStatuslineResetCountdown((2 * 24 + 4) * 60 * 60_000)).toBe('2d4h')
    expect(formatStatuslineResetCountdown(6 * 24 * 60 * 60_000)).toBe('6d')
  })

  it('never exceeds the six characters the script will accept', () => {
    // 23h59m is the longest value reachable; a wider one would be rejected by both scripts and
    // silently blank the field instead of rendering.
    expect(formatStatuslineResetCountdown((23 * 60 + 59) * 60_000)).toBe('23h59m')
    expect(formatStatuslineResetCountdown((23 * 60 + 59) * 60_000).length).toBeLessThanOrEqual(6)
  })

  it('renders nothing for a reset that already passed', () => {
    // Why not "now": a placeholder in the reset slot reads as real data.
    expect(formatStatuslineResetCountdown(0)).toBe('')
    expect(formatStatuslineResetCountdown(-60_000)).toBe('')
  })
})

describe('statuslineResetCountdownPath', () => {
  it('keys on the account vault directory the way the script does', () => {
    const key = '5f7269c8-29a1-4a0b-ba40-31886dcb4dba'
    expect(statuslineResetCountdownPath(`/x/claude-accounts/${key}/auth`)).toBe(
      statuslineResetCountdownPath(`/x/claude-accounts/${key}`)
    )
    expect(statuslineResetCountdownPath(`/x/claude-accounts/${key}/auth`)).toContain(key)
  })

  it('falls back to one shared file for sessions with no config dir', () => {
    // Why a real file and not none: a system-default session has a quota window too, and the
    // script looks for exactly this name when CLAUDE_CONFIG_DIR is unset.
    expect(statuslineResetCountdownPath(null)).toContain(
      'orca-claude-statusline-reset-system-default'
    )
    expect(statuslineResetCountdownPath('/x/weird dir/auth')).toBe(
      statuslineResetCountdownPath(null)
    )
    expect(statuslineResetCountdownPath(`/x/${'a'.repeat(65)}`)).toBe(
      statuslineResetCountdownPath(null)
    )
  })
})

describe('publishStatuslineResetCountdown', () => {
  it('publishes the soonest of the two windows', () => {
    publishStatuslineResetCountdown(
      {
        configDir: null,
        fiveHour: { used_percentage: 37, resets_at: (NOW + 2 * 60 * 60_000) / 1000 },
        sevenDay: { used_percentage: 68, resets_at: (NOW + 50 * 60 * 60_000) / 1000 }
      },
      NOW
    )
    // Why the soonest and not both: three durations do not fit one line, and "when do I get
    // quota back" is answered by the window that comes back first.
    expect(fileFor(null)).toBe('2h')
  })

  it('accepts an ISO reset too, so a schema drift degrades instead of going dark', () => {
    publishStatuslineResetCountdown(
      {
        configDir: null,
        fiveHour: { used_percentage: 37, resets_at: new Date(NOW + 90 * 60_000).toISOString() },
        sevenDay: null
      },
      NOW
    )
    expect(fileFor(null)).toBe('1h30m')
  })

  it('clears a stale countdown when the fresh payload carries no reset', () => {
    publishStatuslineResetCountdown(
      {
        configDir: null,
        fiveHour: { used_percentage: 37, resets_at: (NOW + 2 * 60 * 60_000) / 1000 },
        sevenDay: null
      },
      NOW
    )
    expect(fileFor(null)).toBe('2h')
    // Why overwrite rather than leave the file alone: a countdown nobody refreshes keeps counting
    // down in the user's head while standing still on screen.
    publishStatuslineResetCountdown(
      { configDir: null, fiveHour: { used_percentage: 37 }, sevenDay: null },
      NOW
    )
    expect(fileFor(null)).toBe('')
  })

  it('ignores a reset that already passed', () => {
    publishStatuslineResetCountdown(
      {
        configDir: null,
        fiveHour: { used_percentage: 37, resets_at: (NOW - 60_000) / 1000 },
        sevenDay: null
      },
      NOW
    )
    expect(fileFor(null)).toBe('')
  })

  it('keeps each account on its own file', () => {
    const first = '/x/claude-accounts/acct-one/auth'
    const second = '/x/claude-accounts/acct-two/auth'
    publishStatuslineResetCountdown(
      {
        configDir: first,
        fiveHour: { used_percentage: 10, resets_at: (NOW + 60 * 60_000) / 1000 },
        sevenDay: null
      },
      NOW
    )
    expect(fileFor(first)).toBe('1h')
    // Why per account: two panes signed into different accounts must not read each other's reset.
    expect(existsSync(statuslineResetCountdownPath(second))).toBe(false)
  })
})
