// ORCA-1131: with the dev profile's claude-accounts linked to the real vault, the Jev plugin's
// installer rewrote the real vault settings.json with dev hook paths.
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import { emptyPluginLockfile } from '../../shared/plugins/plugin-install-lockfile'
import { pluginManifestSchema, type PluginManifest } from '../../shared/plugins/plugin-manifest'
import type { PluginWorkerHandle } from './plugin-host-process'
import { buildPluginList } from './plugin-list-projection'
import { PluginService } from './plugin-service'
import type { PluginWorkerFactory } from './plugin-worker-manager'
import {
  DEV_SHARED_VAULT_WORKER_BLOCK_REASON,
  isClaudeVaultOutsideUserData,
  resolveDevSharedVaultWorkerBlockReason
} from './plugin-dev-shared-vault-gate'

const dirs: string[] = []
const services: PluginService[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function devProfileLinkedTo(realVault: string): Promise<string> {
  const userData = await tempDir('orca-1131-dev-profile-')
  await symlink(realVault, join(userData, 'claude-accounts'), 'dir')
  return userData
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('isClaudeVaultOutsideUserData', () => {
  it('is true only for a claude-accounts that resolves outside userData', async () => {
    const realVault = await tempDir('orca-1131-real-vault-')
    const own = await tempDir('orca-1131-own-profile-')
    await mkdir(join(own, 'claude-accounts'))

    expect(isClaudeVaultOutsideUserData(await devProfileLinkedTo(realVault))).toBe(true)
    expect(isClaudeVaultOutsideUserData(own)).toBe(false)
    expect(isClaudeVaultOutsideUserData(await tempDir('orca-1131-empty-'))).toBe(false)
  })
})

describe('resolveDevSharedVaultWorkerBlockReason', () => {
  it('blocks only an unpackaged, non-E2E instance on a linked vault without the opt-in', async () => {
    const userDataPath = await devProfileLinkedTo(await tempDir('orca-1131-real-vault-'))
    const dev = { isPackaged: false, isE2E: false, userDataPath, env: {} }

    expect(resolveDevSharedVaultWorkerBlockReason(dev)).toBe(DEV_SHARED_VAULT_WORKER_BLOCK_REASON)
    expect(resolveDevSharedVaultWorkerBlockReason({ ...dev, isPackaged: true })).toBeNull()
    expect(resolveDevSharedVaultWorkerBlockReason({ ...dev, isE2E: true })).toBeNull()
    expect(
      resolveDevSharedVaultWorkerBlockReason({
        ...dev,
        env: { ORCA_DEV_SHARED_VAULT_PLUGINS: '1' }
      })
    ).toBeNull()
  })
})

function manifest(id: string, capabilities: PluginManifest['capabilities']): PluginManifest {
  return pluginManifestSchema.parse({
    manifestVersion: 1,
    id,
    publisher: 'orca-samples',
    name: id,
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    main: 'worker.js',
    contributes: { commands: [{ id: 'run', title: 'Run' }] },
    capabilities
  })
}

async function pluginRoot(pluginManifest: PluginManifest): Promise<string> {
  const root = await tempDir('orca-1131-plugin-')
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(pluginManifest))
  await writeFile(join(root, 'worker.js'), 'export default async function () {}')
  return root
}

function testWorker(): PluginWorkerHandle {
  return {
    commands: ['run'],
    invokeCommand: vi.fn(async () => null),
    deliverEvent: vi.fn(),
    lastActivityAt: () => Date.now(),
    inFlightCount: () => 0,
    dispose: vi.fn(async () => undefined),
    kill: vi.fn(),
    onExit: vi.fn()
  }
}

describe('PluginService on a dev profile with a linked vault', () => {
  it('starts no spawn-capable worker and shows why, while other plugins still run', async () => {
    const spawner = manifest('spawner', [{ kind: 'process:spawn' }])
    const plain = manifest('plain', [])
    const spawnerRoot = await pluginRoot(spawner)
    const plainRoot = await pluginRoot(plain)
    const factory = vi.fn<PluginWorkerFactory>(async () => testWorker())
    const service = new PluginService({
      userDataPath: spawnerRoot,
      hostVersion: '1.4.0',
      isPluginSystemEnabled: () => true,
      getDisabledPlugins: () => [],
      getPluginConsents: () => ({
        'orca-samples.spawner': fingerprintPluginConsent(spawner),
        'orca-samples.plain': fingerprintPluginConsent(plain)
      }),
      getDevPluginPaths: () => [spawnerRoot, plainRoot],
      getSpawnCapableWorkerBlockReason: () => DEV_SHARED_VAULT_WORKER_BLOCK_REASON,
      workerFactory: factory
    })
    services.push(service)
    await service.initialize()

    await expect(service.invokeCommand('orca-samples.spawner', 'run')).rejects.toThrow(
      'not enabled'
    )
    await service.invokeCommand('orca-samples.plain', 'run')

    expect(factory.mock.calls.map(([options]) => options.pluginId)).toEqual(['orca-samples.plain'])
    const list = await buildPluginList(service, emptyPluginLockfile())
    expect(list.find((entry) => entry.pluginKey === 'orca-samples.spawner')).toMatchObject({
      status: 'errored',
      error: DEV_SHARED_VAULT_WORKER_BLOCK_REASON
    })
  })
})
