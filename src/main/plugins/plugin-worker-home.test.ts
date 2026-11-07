import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hostMocks = vi.hoisted(() => ({ startPluginWorker: vi.fn() }))
vi.mock('./plugin-host-process', () => hostMocks)

import { buildPluginWorkerEnv } from './plugin-worker-env'
import { createPluginWorkerFactory, resolvePluginWorkerHome } from './plugin-worker-home'

// What a plugin's Claude installer does: write its hook into ~/.claude/settings.json.
const INSTALLER = `
const { mkdirSync, writeFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')
const dir = join(homedir(), '.claude')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [process.argv[1]] } }))
`

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

let root: string | null = null

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
    root = null
  }
  vi.clearAllMocks()
})

describe('resolvePluginWorkerHome', () => {
  it('gives a dev instance a home inside its own profile', () => {
    const home = resolvePluginWorkerHome({
      isPackaged: false,
      isE2E: false,
      userDataPath: '/dev/profile'
    })
    expect(home).toBe(join('/dev/profile', 'plugin-home'))
  })

  it('keeps the user home for a packaged app and for E2E, which has its own', () => {
    const base = { userDataPath: '/profile' }
    expect(resolvePluginWorkerHome({ ...base, isPackaged: true, isE2E: false })).toBeNull()
    expect(resolvePluginWorkerHome({ ...base, isPackaged: false, isE2E: true })).toBeNull()
  })
})

describe('createPluginWorkerFactory', () => {
  it('leaves the default factory in place when no home is set', () => {
    expect(createPluginWorkerFactory(null)).toBeUndefined()
  })

  it('creates the home and starts every worker with it', async () => {
    root = mkdtempSync(join(tmpdir(), 'orca-plugin-home-'))
    const home = join(root, 'plugin-home')
    const factory = createPluginWorkerFactory(home)
    const options = { pluginId: 'p' } as Parameters<NonNullable<typeof factory>>[0]
    await factory?.(options)
    expect(existsSync(home)).toBe(true)
    expect(hostMocks.startPluginWorker).toHaveBeenCalledWith({ pluginId: 'p', homeDir: home })
  })
})

describe('a dev plugin worker installing Claude hooks (ORCA-1113)', () => {
  it('leaves the real settings.json byte for byte and writes into the dev profile', () => {
    root = mkdtempSync(join(tmpdir(), 'orca-plugin-home-'))
    const realHome = join(root, 'real-home')
    const realSettings = join(realHome, '.claude', 'settings.json')
    mkdirSync(join(realHome, '.claude'), { recursive: true })
    writeFileSync(realSettings, '{"hooks":{}}\n')
    const before = sha(realSettings)

    const devProfile = join(root, 'dev-profile')
    const workerHome = resolvePluginWorkerHome({
      isPackaged: false,
      isE2E: false,
      userDataPath: devProfile
    })
    expect(workerHome).not.toBeNull()
    mkdirSync(workerHome!, { recursive: true })
    const hookPath = join(devProfile, 'plugins', 'demo', 'gate.mjs')
    execFileSync(process.execPath, ['-e', INSTALLER, hookPath], {
      env: buildPluginWorkerEnv(
        { PATH: process.env.PATH, HOME: realHome, USERPROFILE: realHome },
        process.platform,
        workerHome
      )
    })

    expect(sha(realSettings)).toBe(before)
    const devSettings = join(workerHome!, '.claude', 'settings.json')
    expect(readFileSync(devSettings, 'utf-8')).toContain(JSON.stringify(hookPath).slice(1, -1))
  })
})
