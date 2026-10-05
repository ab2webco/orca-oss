import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginCapability } from '../../shared/plugins/plugin-capabilities'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import {
  pluginManifestSchema,
  type PluginEventName,
  type PluginManifest
} from '../../shared/plugins/plugin-manifest'
import type { PluginWorkerHandle } from './plugin-host-process'
import { PluginService, type PluginRuntimeDelegate } from './plugin-service'
import type { PluginWorkerFactory } from './plugin-worker-manager'

const roots: string[] = []
const services: PluginService[] = []

const payload = {
  source: 'agent-task-complete',
  worktreeId: 'repo::wt1',
  title: 'feat/x - Claude needs input',
  body: 'Should I run the migration?',
  at: 1_790_000_000_000
}

function manifest(
  id: string,
  capabilities: PluginCapability[],
  events: PluginEventName[] = []
): PluginManifest {
  return pluginManifestSchema.parse({
    manifestVersion: 1,
    id,
    publisher: 'orca-samples',
    name: id,
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    main: 'worker.js',
    contributes: { commands: [{ id: 'run', title: 'Run' }], events: events.map((on) => ({ on })) },
    capabilities
  })
}

async function pluginRoot(pluginManifest: PluginManifest): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-notification-events-'))
  roots.push(root)
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(pluginManifest))
  await writeFile(join(root, 'worker.js'), 'export default async function () {}')
  return root
}

const runtimeDelegate: PluginRuntimeDelegate = {
  resolveActiveWorktreeContext: async () => null,
  listTerminals: async () => ({ terminals: [] }),
  sendTerminal: async () => ({ accepted: false }),
  dispatchPluginNotification: async () => ({ delivered: false })
}

async function startService(manifests: PluginManifest[]) {
  const pluginRoots = await Promise.all(manifests.map(pluginRoot))
  const deliverEvent = vi.fn()
  const factory = vi.fn<PluginWorkerFactory>(async () => {
    const handle: PluginWorkerHandle = {
      commands: ['run'],
      invokeCommand: vi.fn(async () => null),
      deliverEvent,
      lastActivityAt: () => Date.now(),
      inFlightCount: () => 0,
      dispose: vi.fn(async () => undefined),
      kill: vi.fn(),
      onExit: vi.fn()
    }
    return handle
  })
  const service = new PluginService({
    userDataPath: pluginRoots[0]!,
    hostVersion: '1.4.0',
    isPluginSystemEnabled: () => true,
    getDisabledPlugins: () => [],
    getPluginConsents: () =>
      Object.fromEntries(
        manifests.map((entry) => [`orca-samples.${entry.id}`, fingerprintPluginConsent(entry)])
      ),
    getDevPluginPaths: () => pluginRoots,
    workerFactory: factory
  })
  services.push(service)
  service.setRuntimeDelegate(runtimeDelegate)
  await service.initialize()
  return { service, deliverEvent }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PluginService notification.dispatched gate', () => {
  it('leaves notification.dispatched out of a runtime subscription without notifications:observe', async () => {
    const { service } = await startService([manifest('snoop', [{ kind: 'events:subscribe' }])])

    await expect(
      service.executeHostCall(
        'orca-samples.snoop',
        'events.subscribe',
        { events: ['notification.dispatched', 'worktree.created'] },
        { viaPanel: false }
      )
    ).resolves.toEqual({ ok: true, value: { subscribed: ['worktree.created'] } })
  })

  it('subscribes a plugin that holds notifications:observe', async () => {
    const { service } = await startService([
      manifest('relay', [{ kind: 'events:subscribe' }, { kind: 'notifications:observe' }])
    ])

    await expect(
      service.executeHostCall(
        'orca-samples.relay',
        'events.subscribe',
        { events: ['notification.dispatched'] },
        { viaPanel: false }
      )
    ).resolves.toEqual({ ok: true, value: { subscribed: ['notification.dispatched'] } })
  })

  it('activates and delivers to a consented manifest subscriber', async () => {
    const { service, deliverEvent } = await startService([
      manifest(
        'relay',
        [{ kind: 'events:subscribe' }, { kind: 'notifications:observe' }],
        ['notification.dispatched']
      )
    ])

    service.emitEvent('notification.dispatched', payload)
    await vi.waitFor(() =>
      expect(deliverEvent).toHaveBeenCalledWith('notification.dispatched', payload)
    )
  })
})
