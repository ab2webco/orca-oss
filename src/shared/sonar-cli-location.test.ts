import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveSonarCli } from './sonar-cli-location'

const HASH = 'a'.repeat(64)

describe('resolveSonarCli', () => {
  let userDataDir: string
  let pluginDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-sonar-location-'))
    pluginDir = join(userDataDir, 'plugins', 'ab2web.orca-sonar')
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  function installTree(hash: string): void {
    mkdirSync(join(pluginDir, hash, 'bin'), { recursive: true })
    writeFileSync(join(pluginDir, hash, 'bin', 'orca-sonar.ts'), '')
  }

  it('reports not_installed when the plugin has no current pointer', () => {
    expect(resolveSonarCli(userDataDir)).toEqual({
      ok: false,
      reason: 'not_installed'
    })
  })

  it('rejects a pointer that is not a content hash', () => {
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'current'), '../../escape\n')
    expect(resolveSonarCli(userDataDir)).toEqual({
      ok: false,
      reason: 'invalid_pointer'
    })
  })

  it('reports missing_entry when the pointed tree has no CLI', () => {
    mkdirSync(join(pluginDir, HASH), { recursive: true })
    writeFileSync(join(pluginDir, 'current'), `${HASH}\n`)
    expect(resolveSonarCli(userDataDir)).toEqual({
      ok: false,
      reason: 'missing_entry'
    })
  })

  it('resolves the CLI entry inside the current install tree', () => {
    installTree(HASH)
    writeFileSync(join(pluginDir, 'current'), `${HASH}\n`)
    expect(resolveSonarCli(userDataDir)).toEqual({
      ok: true,
      cliPath: join(pluginDir, HASH, 'bin', 'orca-sonar.ts')
    })
  })
})
