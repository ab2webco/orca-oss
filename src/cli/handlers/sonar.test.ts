import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { SONAR_HANDLERS } from './sonar'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('../runtime/metadata', () => ({ getDefaultUserDataPath: () => userData.dir }))

describe('orca sonar handler', () => {
  beforeEach(() => {
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-sonar-handler-'))
    const pluginDir = join(userData.dir, 'plugins', 'ab2web.orca-sonar')
    const hash = 'c'.repeat(64)
    mkdirSync(join(pluginDir, hash, 'bin'), { recursive: true })
    writeFileSync(join(pluginDir, hash, 'bin', 'orca-sonar.ts'), '')
    writeFileSync(join(pluginDir, 'current'), hash)
  })

  afterEach(() => {
    rmSync(userData.dir, { recursive: true, force: true })
  })

  it("asks the local runtime's plugins.list and refuses a disabled plugin", async () => {
    const call = vi.fn(async () => ({
      result: [{ pluginKey: 'ab2web.orca-sonar', status: 'disabled' }]
    }))
    const client = { call, isRemote: false } as unknown as RuntimeClient

    await expect(
      SONAR_HANDLERS.sonar({
        flags: new Map(),
        client,
        cwd: '/tmp',
        json: false,
        rawArgs: ['find', 'x']
      })
    ).rejects.toMatchObject({ code: 'sonar_plugin_inactive' })
    expect(call).toHaveBeenCalledWith('plugins.list')
  })
})
