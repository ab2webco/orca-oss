import { describe, expect, it, vi } from 'vitest'
import type {
  PluginCapability,
  PluginCapabilityKind
} from '../../shared/plugins/plugin-capabilities'
import { pluginManifestSchema, type PluginEventName } from '../../shared/plugins/plugin-manifest'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import { PluginEventBus } from './plugin-event-bus'
import { deliverPluginEvent } from './plugin-event-delivery'
import type { PluginWorkerHandle } from './plugin-host-process'

const payload = {
  source: 'agent-task-complete',
  worktreeId: 'repo::wt1',
  title: 'feat/x - Claude needs input',
  body: 'Should I run the migration?',
  at: 1_790_000_000_000
}

function plugin(
  id: string,
  options: { events?: PluginEventName[]; capabilities: PluginCapability[] }
): ValidDiscoveredPlugin {
  return {
    pluginKey: `orca-samples.${id}`,
    rootDir: `/plugins/${id}`,
    manifest: pluginManifestSchema.parse({
      manifestVersion: 1,
      id,
      publisher: 'orca-samples',
      name: id,
      version: '1.0.0',
      engines: { orca: '>=1.0.0' },
      pluginApi: 1,
      main: 'worker.js',
      contributes: { events: (options.events ?? []).map((on) => ({ on })) },
      capabilities: options.capabilities
    }),
    consentFingerprint: 'sha256-test',
    contentHash: null,
    isDev: true
  }
}

function harness() {
  const deliverEvent = vi.fn()
  const handle: PluginWorkerHandle = {
    commands: [],
    invokeCommand: vi.fn(async () => null),
    deliverEvent,
    lastActivityAt: () => 0,
    inFlightCount: () => 0,
    dispose: vi.fn(async () => undefined),
    kill: vi.fn(),
    onExit: vi.fn()
  }
  const workerController = {
    ensure: vi.fn(async () => handle),
    deliverEventIfRunning: vi.fn()
  }
  return { deliverEvent, workerController }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('notification.dispatched capability gate', () => {
  it('delivers to a manifest subscriber that holds notifications:observe', async () => {
    const { deliverEvent, workerController } = harness()
    deliverPluginEvent({
      event: 'notification.dispatched',
      payload,
      plugins: [
        plugin('relay', {
          events: ['notification.dispatched'],
          capabilities: [{ kind: 'events:subscribe' }, { kind: 'notifications:observe' }]
        })
      ],
      eventBus: new PluginEventBus(() => null),
      workerController,
      isRuntimeApproved: () => true,
      logWarning: vi.fn()
    })
    await flush()
    expect(deliverEvent).toHaveBeenCalledWith('notification.dispatched', payload)
  })

  it('refuses a runtime subscription from a plugin without notifications:observe', () => {
    const bus = new PluginEventBus(() => ['events:subscribe'])
    expect(
      bus.subscribe('orca-samples.snoop', ['notification.dispatched', 'worktree.created'])
    ).toEqual(['worktree.created'])
    expect(bus.isDynamicallySubscribed('orca-samples.snoop', 'notification.dispatched')).toBe(false)
  })

  it('never delivers to a plugin without notifications:observe, even if it is subscribed', () => {
    const { workerController } = harness()
    let granted: PluginCapabilityKind[] = ['events:subscribe', 'notifications:observe']
    const bus = new PluginEventBus(() => granted)
    // Subscribed while it still held the capability; the grant is gone now.
    bus.subscribe('orca-samples.snoop', ['notification.dispatched'])
    granted = ['events:subscribe']
    deliverPluginEvent({
      event: 'notification.dispatched',
      payload,
      plugins: [plugin('snoop', { capabilities: [{ kind: 'events:subscribe' }] })],
      eventBus: bus,
      workerController,
      isRuntimeApproved: () => true,
      logWarning: vi.fn()
    })
    expect(workerController.deliverEventIfRunning).not.toHaveBeenCalled()
    expect(workerController.ensure).not.toHaveBeenCalled()
  })

  it('keeps delivering the existing events to an events:subscribe-only runtime subscriber', () => {
    const { workerController } = harness()
    const bus = new PluginEventBus(() => ['events:subscribe'])
    bus.subscribe('orca-samples.watch', ['worktree.created'])
    deliverPluginEvent({
      event: 'worktree.created',
      payload: { worktreeId: 'repo::wt1', path: '/repo', branch: 'main' },
      plugins: [plugin('watch', { capabilities: [{ kind: 'events:subscribe' }] })],
      eventBus: bus,
      workerController,
      isRuntimeApproved: () => true,
      logWarning: vi.fn()
    })
    expect(workerController.deliverEventIfRunning).toHaveBeenCalledWith(
      'orca-samples.watch',
      'worktree.created',
      { worktreeId: 'repo::wt1', path: '/repo', branch: 'main' }
    )
  })

  it('drops a plugin-sourced notification before any plugin sees it', async () => {
    const { deliverEvent, workerController } = harness()
    deliverPluginEvent({
      event: 'notification.dispatched',
      payload: { ...payload, source: 'plugin' },
      plugins: [
        plugin('relay', {
          events: ['notification.dispatched'],
          capabilities: [{ kind: 'events:subscribe' }, { kind: 'notifications:observe' }]
        })
      ],
      eventBus: new PluginEventBus(() => null),
      workerController,
      isRuntimeApproved: () => true,
      logWarning: vi.fn()
    })
    await flush()
    expect(workerController.ensure).not.toHaveBeenCalled()
    expect(deliverEvent).not.toHaveBeenCalled()
  })
})
