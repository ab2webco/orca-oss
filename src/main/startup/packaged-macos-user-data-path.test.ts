import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
let appDataDir: string

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

/** The profile a pre-rename macOS build wrote: Application Support/<CFBundleName>. */
function seedProfile(dirName: string, transcript: string): void {
  const dir = join(appDataDir, dirName, 'claude-accounts', 'account-1')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session-1.jsonl'), transcript, 'utf-8')
}

beforeEach(() => {
  appDataDir = mkdtempSync(join(tmpdir(), 'orca-macos-userdata-'))
  appMock.paths = new Map([
    ['appData', appDataDir],
    // Electron derives this from app.getName(), which on a packaged macOS build
    // is CFBundleName — electron-builder writes productName into it.
    ['userData', join(appDataDir, 'Orca Lab')]
  ])
  appMock.isPackaged = true
  appMock.setPath.mockClear()
  setPlatform('darwin')
  vi.resetModules()
})

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  rmSync(appDataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/**
 * Why leer package.json y no fijar el literal otra vez: `app.getName()` en un
 * build empaquetado resuelve desde ahí, y de ahí sale el nombre del directorio.
 * El pin se escribió 'Orca' y en un volumen case-insensitive coincidió por
 * accidente con el 'orca' real; en uno case-sensitive habría creado un perfil
 * vacío. Este caso ata el pin a su fuente en vez de a mi lectura de ella.
 */
describe('el nombre pineado sale de la misma fuente que app.getName()', () => {
  it('coincide exactamente, incluida la caja', async () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8')
    ) as { name: string; productName?: string }
    const resolvedAppName = pkg.productName ?? pkg.name

    setPlatform('darwin')
    appMock.paths.set('appData', appDataDir)
    appMock.paths.set('userData', join(appDataDir, resolvedAppName))
    const { configurePackagedMacosUserDataPath } = await import('./packaged-macos-user-data-path')
    configurePackagedMacosUserDataPath()

    expect(appMock.paths.get('userData')).toBe(join(appDataDir, resolvedAppName))
  })
})

describe('configurePackagedMacosUserDataPath', () => {
  it('keeps userData on the pre-rename profile when productName changes', async () => {
    const transcript = '{"type":"user","message":"do not lose me"}\n'
    seedProfile('orca', transcript)
    const { configurePackagedMacosUserDataPath } = await import('./packaged-macos-user-data-path')

    configurePackagedMacosUserDataPath()

    // The whole point: a productName rename must not move this path.
    expect(appMock.paths.get('userData')).toBe(join(appDataDir, 'orca'))
    expect(
      readFileSync(
        join(appDataDir, 'orca', 'claude-accounts', 'account-1', 'session-1.jsonl'),
        'utf-8'
      )
    ).toBe(transcript)
  })

  it('pins the same directory even when no legacy profile exists yet', async () => {
    const { configurePackagedMacosUserDataPath } = await import('./packaged-macos-user-data-path')

    configurePackagedMacosUserDataPath()

    expect(appMock.paths.get('userData')).toBe(join(appDataDir, 'orca'))
  })

  it('leaves Linux and Windows untouched', async () => {
    const { configurePackagedMacosUserDataPath } = await import('./packaged-macos-user-data-path')

    for (const platform of ['linux', 'win32'] as const) {
      setPlatform(platform)
      appMock.paths.set('userData', join(appDataDir, 'Orca Lab'))
      configurePackagedMacosUserDataPath()
      expect(appMock.paths.get('userData')).toBe(join(appDataDir, 'Orca Lab'))
    }
  })

  it('never overwrites a populated profile with the renamed copy', async () => {
    // The rescue runs on machines that already hold accounts and transcripts. If it
    // ever copies over them, a user loses working credentials for a stale set.
    const kept = '{"type":"user","message":"the profile in use"}\n'
    const stale = '{"type":"user","message":"the renamed leftover"}\n'
    seedProfile('orca', kept)
    seedProfile('Orca Lab', stale)
    const { configurePackagedMacosUserDataPath } = await import('./packaged-macos-user-data-path')

    configurePackagedMacosUserDataPath()

    expect(
      readFileSync(
        join(appDataDir, 'orca', 'claude-accounts', 'account-1', 'session-1.jsonl'),
        'utf-8'
      )
    ).toBe(kept)
  })

  it('does not repin an unpackaged dev run', async () => {
    appMock.isPackaged = false
    const { configurePackagedMacosUserDataPath } = await import('./packaged-macos-user-data-path')

    configurePackagedMacosUserDataPath()

    expect(appMock.setPath).not.toHaveBeenCalled()
  })
})
