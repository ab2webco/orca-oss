import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultUserDataPath, readMetadata } from './metadata'
import { RuntimeClientError } from './types'

/** A PID no kernel hands out: process.kill(pid, 0) answers ESRCH for it. */
const DEAD_PID = 2_147_483_647

/** How a userData directory was left behind. The two halves fail apart: a crash
 *  leaves the socket with no owner, a clean exit or a recycled PID leaves an
 *  owner with no socket. */
type RuntimeState = { socket: boolean; ownerAlive: boolean; authToken?: string | null }

const LIVE: RuntimeState = { socket: true, ownerAlive: true }
const CRASHED: RuntimeState = { socket: true, ownerAlive: false }
const EXITED: RuntimeState = { socket: false, ownerAlive: false }
const SOCKET_GONE: RuntimeState = { socket: false, ownerAlive: true }
const LIVE_TOKENLESS: RuntimeState = { socket: true, ownerAlive: true, authToken: null }

const ENV_KEYS = ['ORCA_USER_DATA_PATH', 'XDG_CONFIG_HOME', 'APPDATA'] as const

let base: string
let savedEnv: Record<string, string | undefined>

function seed(name: string, state: RuntimeState, ageMinutes = 0): void {
  const dir = join(base, name)
  mkdirSync(join(dir, 'daemon'), { recursive: true })
  const endpoint = join(dir, 'daemon', 'daemon-v1.sock')
  if (state.socket) {
    writeFileSync(endpoint, '')
  } else {
    rmSync(endpoint, { force: true })
  }
  const metadataPath = join(dir, 'orca-runtime.json')
  writeFileSync(
    metadataPath,
    JSON.stringify({
      runtimeId: name,
      pid: state.ownerAlive ? process.pid : DEAD_PID,
      transports: [{ kind: 'unix', endpoint }],
      authToken: state.authToken === undefined ? 'token' : state.authToken,
      startedAt: 0
    })
  )
  const when = new Date(Date.now() - ageMinutes * 60_000)
  utimesSync(metadataPath, when, when)
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'orca-userdata-'))
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  process.env.XDG_CONFIG_HOME = base
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  rmSync(base, { recursive: true, force: true })
})

describe('getDefaultUserDataPath on Linux', () => {
  it('returns the historical path when no directory holds runtime metadata', () => {
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca'))
  })

  it('returns the only directory that holds a runtime, whichever name it uses', () => {
    seed('orca', LIVE)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca'))
    rmSync(join(base, 'orca'), { recursive: true })
    seed('orca-ide', LIVE)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca-ide'))
  })

  it('prefers the packaged orca-ide runtime over a crashed orca install (ORCA-516)', () => {
    seed('orca', CRASHED)
    seed('orca-ide', LIVE)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca-ide'))
  })

  it('keeps the live runtime even when a dead one wrote its metadata more recently', () => {
    seed('orca', LIVE, 60)
    seed('orca-ide', CRASHED, 0)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca'))
  })

  it('ignores a runtime whose socket is gone even though its PID is taken', () => {
    seed('orca-ide', SOCKET_GONE, 0)
    seed('orca', LIVE, 60)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca'))
  })

  it('skips a reachable runtime whose metadata carries no auth token', () => {
    seed('orca-ide', LIVE_TOKENLESS, 0)
    seed('orca', LIVE, 60)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca'))
  })

  it('breaks a tie between two live runtimes by recency, not by name order', () => {
    seed('orca', LIVE, 60)
    seed('orca-ide', LIVE, 0)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca-ide'))
    seed('orca', LIVE, 0)
    seed('orca-ide', LIVE, 60)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca'))
  })

  it('discovers a directory name that is not on the known list', () => {
    seed('orca', CRASHED)
    seed('orca-nightly', LIVE)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca-nightly'))
  })

  it('names the freshest dead runtime when nothing answers', () => {
    seed('orca', EXITED, 60)
    seed('orca-ide', CRASHED, 0)
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'orca-ide'))
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const home = mkdtempSync(join(tmpdir(), 'orca-home-'))
    const previousBase = base
    try {
      delete process.env.XDG_CONFIG_HOME
      base = join(home, '.config')
      seed('orca-ide', LIVE)
      expect(getDefaultUserDataPath('linux', home)).toBe(join(home, '.config', 'orca-ide'))
    } finally {
      base = previousBase
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('lets an explicit ORCA_USER_DATA_PATH win over a live discovery', () => {
    seed('orca-ide', LIVE)
    process.env.ORCA_USER_DATA_PATH = join(base, 'pinned-orca')
    expect(getDefaultUserDataPath('linux', '/home/me')).toBe(join(base, 'pinned-orca'))
  })
})

describe('getDefaultUserDataPath on the other platforms', () => {
  it('keeps the macOS path even with live Linux-style directories present', () => {
    seed('orca-ide', LIVE)
    expect(getDefaultUserDataPath('darwin', '/home/me')).toBe(
      join('/home/me', 'Library', 'Application Support', 'orca')
    )
  })

  it('keeps the Windows path under APPDATA', () => {
    seed('orca-ide', LIVE)
    process.env.APPDATA = join(base, 'Roaming')
    expect(getDefaultUserDataPath('win32', '/home/me')).toBe(join(base, 'Roaming', 'orca'))
  })

  it('still fails on win32 when APPDATA is absent', () => {
    expect(() => getDefaultUserDataPath('win32', '/home/me')).toThrow(RuntimeClientError)
  })
})

describe('readMetadata', () => {
  it('names the other directories it searched when the chosen one has no runtime', () => {
    seed('orca-ide', CRASHED)
    expect(() => readMetadata(join(base, 'orca'))).toThrow(
      new RegExp(`Also searched .*${join(base, 'orca-ide')}`)
    )
  })

  it('stays silent about the search for a userData path the caller chose', () => {
    seed('orca-ide', CRASHED)
    const elsewhere = mkdtempSync(join(tmpdir(), 'orca-explicit-'))
    try {
      expect(() => readMetadata(elsewhere)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('Also searched') })
      )
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})
