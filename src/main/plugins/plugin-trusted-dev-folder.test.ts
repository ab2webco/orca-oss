import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fingerprintPluginConsent,
  TRUSTED_DEV_FOLDER_CONTENT_IDENTITY
} from '../../shared/plugins/plugin-consent-fingerprint'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import type { PluginWorkerHandle } from './plugin-host-process'
import { PluginService } from './plugin-service'
import type { PluginWorkerFactory } from './plugin-worker-manager'
import {
  discoverPlugins,
  isInvalidDiscoveredPlugin,
  type ValidDiscoveredPlugin
} from './plugin-discovery'
import { verifyInstructionalPluginContent } from './plugin-instructional-content-integrity'

const roots: string[] = []
const services: PluginService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-trusted-dev-'))
  roots.push(root)
  return root
}

function skillManifest(capabilities: { kind: string }[] = [{ kind: 'skills:contribute' }]) {
  return {
    manifestVersion: 1,
    id: 'whatsapp',
    publisher: 'acme',
    name: 'WhatsApp',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    main: 'worker.js',
    contributes: { skills: [{ path: 'skills/send' }] },
    capabilities
  }
}

async function skillPlugin(root: string): Promise<void> {
  await mkdir(join(root, 'skills', 'send'), { recursive: true })
  await writeFile(join(root, 'skills', 'send', 'SKILL.md'), '---\nname: send\n---\n')
  await writeFile(join(root, 'worker.js'), 'export default async function () {}')
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(skillManifest()))
}

async function discoverOne(options: {
  pluginsDir?: string
  devPluginPaths?: string[]
  trustedDevPluginPaths?: string[]
}): Promise<ValidDiscoveredPlugin> {
  const [plugin] = await discoverPlugins({
    pluginsDir: options.pluginsDir ?? (await tempDir()),
    devPluginPaths: options.devPluginPaths ?? [],
    trustedDevPluginPaths: options.trustedDevPluginPaths ?? [],
    hostVersion: '1.4.0'
  })
  if (!plugin || isInvalidDiscoveredPlugin(plugin)) {
    throw new Error(`expected a valid plugin, got ${JSON.stringify(plugin)}`)
  }
  return plugin
}

async function editContent(root: string): Promise<void> {
  await writeFile(join(root, 'skills', 'send', 'SKILL.md'), '---\nname: send\n---\nrm -rf\n')
  await writeFile(join(root, 'worker.js'), 'export default async function () { return 2 }')
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
}

describe('trusted dev folder consent', () => {
  it('keeps consent when content in a trusted dev folder changes', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const options = { devPluginPaths: [root], trustedDevPluginPaths: [root] }

    const before = await discoverOne(options)
    await editContent(root)
    const after = await discoverOne(options)

    expect(after.trustedDevFolder).toBe(true)
    expect(after.consentFingerprint).toBe(before.consentFingerprint)
  })

  it('still changes consent when a trusted dev plugin changes capabilities', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const options = { devPluginPaths: [root], trustedDevPluginPaths: [root] }

    const before = await discoverOne(options)
    await writeFile(
      join(root, 'orca-plugin.json'),
      JSON.stringify(skillManifest([{ kind: 'skills:contribute' }, { kind: 'storage' }]))
    )
    const after = await discoverOne(options)

    expect(after.consentFingerprint).not.toBe(before.consentFingerprint)
  })

  it('keeps binding an untrusted dev folder to its tree', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const options = { devPluginPaths: [root], trustedDevPluginPaths: [] }

    const before = await discoverOne(options)
    await editContent(root)
    const after = await discoverOne(options)

    expect(after.trustedDevFolder).toBe(false)
    expect(after.consentFingerprint).not.toBe(before.consentFingerprint)
  })

  it('asks for consent again when a folder becomes trusted', async () => {
    const root = await tempDir()
    await skillPlugin(root)

    const untrusted = await discoverOne({ devPluginPaths: [root] })
    const trusted = await discoverOne({ devPluginPaths: [root], trustedDevPluginPaths: [root] })

    expect(trusted.consentFingerprint).not.toBe(untrusted.consentFingerprint)
  })

  it('ignores trust for an installed plugin', async () => {
    const pluginsDir = await tempDir()
    const hash = 'a'.repeat(64)
    const versionDir = join(pluginsDir, 'acme.whatsapp', hash)
    await mkdir(versionDir, { recursive: true })
    await writeFile(join(pluginsDir, 'acme.whatsapp', 'current'), hash)
    await skillPlugin(versionDir)

    const plugin = await discoverOne({ pluginsDir, trustedDevPluginPaths: [versionDir] })

    expect(plugin.trustedDevFolder).toBe(false)
    expect(plugin.consentContentHash).toBe(hash)
  })
})

describe('trusted dev folder instructional reads', () => {
  it('serves edited instructional content from a trusted dev folder', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const plugin = await discoverOne({ devPluginPaths: [root], trustedDevPluginPaths: [root] })

    await editContent(root)

    await expect(verifyInstructionalPluginContent(plugin)).resolves.toBeUndefined()
  })

  it('rejects edited instructional content from an untrusted dev folder', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const plugin = await discoverOne({ devPluginPaths: [root] })

    await editContent(root)

    await expect(verifyInstructionalPluginContent(plugin)).rejects.toThrow(
      'changed since it was reviewed'
    )
  })
})

describe('trusted dev folder runtime', () => {
  function serviceFor(root: string, trusted: string[]) {
    const consent = fingerprintPluginConsent(
      pluginManifestSchema.parse(skillManifest()),
      TRUSTED_DEV_FOLDER_CONTENT_IDENTITY
    )
    const workers: { dispose: ReturnType<typeof vi.fn> }[] = []
    const factory = vi.fn<PluginWorkerFactory>(async () => {
      const handle: PluginWorkerHandle & { dispose: ReturnType<typeof vi.fn> } = {
        commands: [],
        invokeCommand: vi.fn(async () => null),
        deliverEvent: vi.fn(),
        lastActivityAt: () => Date.now(),
        inFlightCount: () => 0,
        dispose: vi.fn(async () => undefined),
        kill: vi.fn(),
        onExit: vi.fn()
      }
      workers.push(handle)
      return handle
    })
    const service = new PluginService({
      userDataPath: root,
      hostVersion: '1.4.0',
      isPluginSystemEnabled: () => true,
      getDisabledPlugins: () => [],
      getPluginConsents: () => ({ 'acme.whatsapp': consent }),
      getDevPluginPaths: () => [root],
      getTrustedDevPluginPaths: () => trusted,
      workerFactory: factory
    })
    services.push(service)
    return { service, workers }
  }

  it('keeps a trusted dev plugin approved and its worker up across content edits', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const { service, workers } = serviceFor(root, [root])
    await service.initialize()
    await service['workerController'].ensure(service.findValidPlugin('acme.whatsapp')!)

    await editContent(root)
    await service.refresh()

    expect(service.activationState(service.findValidPlugin('acme.whatsapp')!)).toBe('approved')
    expect(workers[0]!.dispose).not.toHaveBeenCalled()
  })

  it('makes an untrusted dev plugin with the same consent pending', async () => {
    const root = await tempDir()
    await skillPlugin(root)
    const { service } = serviceFor(root, [])
    await service.initialize()

    expect(service.activationState(service.findValidPlugin('acme.whatsapp')!)).toBe('pending')
  })
})
