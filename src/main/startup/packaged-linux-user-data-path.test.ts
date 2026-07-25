import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock } = vi.hoisted(() => ({
  appMock: {
    paths: new Map<string, string>(),
    isPackaged: true,
    getPath: vi.fn((name: string) => appMock.paths.get(name) ?? ''),
    setPath: vi.fn((name: string, value: string) => {
      appMock.paths.set(name, value)
    })
  }
}))

vi.mock('electron', () => ({ app: appMock }))
vi.mock('../e2e-config', () => ({ getMainE2EConfig: () => ({}) }))
vi.mock('../codex-cli/command', () => ({ getVersionManagerBinPaths: () => [] }))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
let appDataDir: string

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

/** Seeds a pre-pin profile holding a Claude transcript and terminal history. */
function seedLegacyProfile(dirName: string, transcript: string): string {
  const legacyDir = join(appDataDir, dirName)
  const transcriptDir = join(legacyDir, 'claude-accounts', 'account-1', 'auth', 'projects', 'repo')
  mkdirSync(transcriptDir, { recursive: true })
  writeFileSync(join(transcriptDir, 'session-1.jsonl'), transcript, 'utf-8')
  mkdirSync(join(legacyDir, 'terminal-history'), { recursive: true })
  writeFileSync(join(legacyDir, 'terminal-history', 'pane-1.log'), 'scrollback', 'utf-8')
  return legacyDir
}

function pinnedTranscriptPath(): string {
  return join(
    appDataDir,
    'orca-ide',
    'claude-accounts',
    'account-1',
    'auth',
    'projects',
    'repo',
    'session-1.jsonl'
  )
}

beforeEach(() => {
  appDataDir = mkdtempSync(join(tmpdir(), 'orca-userdata-'))
  appMock.paths = new Map([
    ['appData', appDataDir],
    // Electron derives this from the app name, so a packaged Linux build can land
    // on the executableName before the path is pinned.
    ['userData', join(appDataDir, 'orca')]
  ])
  appMock.isPackaged = true
  appMock.setPath.mockClear()
  setPlatform('linux')
  // Why: each case drives the module against a fresh temp profile, so a cached
  // instance would carry the previous case's resolved paths.
  vi.resetModules()
})

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  rmSync(appDataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('configurePackagedLinuxUserDataPath', () => {
  it('pins userData to a name-independent directory on packaged Linux', async () => {
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    // Why: app.setName('Orca') at whenReady must not be able to move this path.
    expect(appMock.paths.get('userData')).toBe(join(appDataDir, 'orca-ide'))
  })

  it('recovers Claude transcripts and history from the pre-pin profile', async () => {
    const transcript = '{"type":"user","message":"do not lose me"}\n'
    seedLegacyProfile('orca', transcript)
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    expect(readFileSync(pinnedTranscriptPath(), 'utf-8')).toBe(transcript)
    expect(existsSync(join(appDataDir, 'orca-ide', 'terminal-history', 'pane-1.log'))).toBe(true)
  })

  it('recovers from a legacy directory the current launch no longer resolves', async () => {
    const transcript = '{"type":"user","message":"older install"}\n'
    seedLegacyProfile('orca', transcript)
    // This launch resolved a third name, so only the legacy-name sweep can find it.
    appMock.paths.set('userData', join(appDataDir, 'com.stablyai.orca'))
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    expect(readFileSync(pinnedTranscriptPath(), 'utf-8')).toBe(transcript)
  })

  it('never overwrites transcripts already in the pinned profile', async () => {
    seedLegacyProfile('orca', '{"type":"user","message":"stale"}\n')
    const current = '{"type":"user","message":"current"}\n'
    mkdirSync(
      join(appDataDir, 'orca-ide', 'claude-accounts', 'account-1', 'auth', 'projects', 'repo'),
      {
        recursive: true
      }
    )
    writeFileSync(pinnedTranscriptPath(), current, 'utf-8')
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    expect(readFileSync(pinnedTranscriptPath(), 'utf-8')).toBe(current)
  })

  it('adopts a daemon that outlived the update instead of failing on its token', async () => {
    // Reported by a Linux user right after updating:
    // "ENOENT: no such file or directory, open '~/.config/orca/daemon/daemon-v27.token'"
    // The daemon survives the update by design, so the new app must reach the
    // runtime dir it actually bound — a copy would point at a dead socket.
    const legacyDaemon = join(appDataDir, 'orca', 'daemon')
    mkdirSync(legacyDaemon, { recursive: true })
    writeFileSync(join(legacyDaemon, 'daemon-v27.token'), 'secret-token', 'utf-8')
    writeFileSync(join(legacyDaemon, 'daemon-v27.sock'), '', 'utf-8')
    appMock.paths.set('userData', join(appDataDir, 'orca'))
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    const pinnedToken = join(appDataDir, 'orca-ide', 'daemon', 'daemon-v27.token')
    expect(readFileSync(pinnedToken, 'utf-8')).toBe('secret-token')
    // The link must resolve to the live directory, not a copy of it.
    expect(lstatSync(join(appDataDir, 'orca-ide', 'daemon')).isSymbolicLink()).toBe(true)
  })

  it('does not redirect a daemon directory the pinned profile already owns', async () => {
    const legacyDaemon = join(appDataDir, 'orca', 'daemon')
    mkdirSync(legacyDaemon, { recursive: true })
    writeFileSync(join(legacyDaemon, 'daemon-v27.token'), 'stale', 'utf-8')
    const pinnedDaemon = join(appDataDir, 'orca-ide', 'daemon')
    mkdirSync(pinnedDaemon, { recursive: true })
    writeFileSync(join(pinnedDaemon, 'daemon-v28.token'), 'current', 'utf-8')
    appMock.paths.set('userData', join(appDataDir, 'orca'))
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    expect(lstatSync(pinnedDaemon).isSymbolicLink()).toBe(false)
    expect(statSync(pinnedDaemon).isDirectory()).toBe(true)
    expect(readFileSync(join(pinnedDaemon, 'daemon-v28.token'), 'utf-8')).toBe('current')
  })

  it('ignores a legacy daemon directory with no socket or token', async () => {
    mkdirSync(join(appDataDir, 'orca', 'daemon'), { recursive: true })
    appMock.paths.set('userData', join(appDataDir, 'orca'))
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    // Nothing to adopt: the app should just spawn its own daemon.
    expect(existsSync(join(appDataDir, 'orca-ide', 'daemon'))).toBe(false)
  })

  it('leaves macOS and Windows paths untouched', async () => {
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    for (const platform of ['darwin', 'win32'] as const) {
      setPlatform(platform)
      const before = appMock.paths.get('userData')
      configurePackagedLinuxUserDataPath()
      // Why: those platforms derive userData from a bundle/app id that is stable
      // across builds, so repinning would itself orphan an existing profile.
      expect(appMock.paths.get('userData')).toBe(before)
    }
  })

  it('does not repin an unpackaged dev run', async () => {
    appMock.isPackaged = false
    const { configurePackagedLinuxUserDataPath } = await import('./packaged-linux-user-data-path')

    configurePackagedLinuxUserDataPath()

    expect(appMock.paths.get('userData')).toBe(join(appDataDir, 'orca'))
  })
})
