import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Automation, AutomationCreateInput } from '../../shared/automations-types'
import { pluginManifestSchema, type PluginManifest } from '../../shared/plugins/plugin-manifest'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import type { Store } from '../persistence'
import type { PluginService } from './plugin-service'
import { reconcilePluginAutomations } from './plugin-automation-reconciliation'

const pluginKey = 'orca-samples.wa'

function manifestWith(
  automations: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {}
): PluginManifest {
  return pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'wa',
    publisher: 'orca-samples',
    name: 'WhatsApp',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { automations },
    capabilities: [],
    ...overrides
  })
}

const triage = {
  id: 'triage',
  title: 'WhatsApp: triage',
  trigger: '*/5 8-18 * * 1-5',
  timezone: 'America/Bogota',
  precheck: 'wa-scope pending',
  prompt: 'PROMPT-triage.md',
  provider: 'claude'
}

function createStore(initial: Automation[] = []): {
  store: Store
  rows: () => Automation[]
} {
  let rows = [...initial]
  let nextId = 1
  const store = {
    listAutomations: () => [...rows],
    createAutomation: (input: AutomationCreateInput): Automation => {
      const created = {
        ...input,
        id: `automation-${nextId++}`,
        enabled: input.enabled ?? true,
        // createAutomation forces this off for any mode but `existing`.
        reuseSession: input.workspaceMode === 'existing' ? (input.reuseSession ?? false) : false
      } as unknown as Automation
      rows = [...rows, created]
      return created
    },
    deleteAutomation: (id: string) => {
      rows = rows.filter((row) => row.id !== id)
    }
  } as unknown as Store
  return { store, rows: () => rows }
}

function createPluginService(
  plugins: { manifest: PluginManifest; rootDir: string; activation: 'approved' | 'disabled' }[]
): PluginService {
  const activationByKey = new Map(plugins.map((entry) => [entry.rootDir, entry.activation]))
  return {
    getDiscovered: (): ValidDiscoveredPlugin[] =>
      plugins.map((entry) => ({
        pluginKey,
        rootDir: entry.rootDir,
        manifest: entry.manifest,
        consentFingerprint: 'sha256-current',
        contentHash: null,
        isDev: true
      })),
    activationState: (plugin: ValidDiscoveredPlugin) => activationByKey.get(plugin.rootDir)
  } as unknown as PluginService
}

let rootDir: string

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'orca-plugin-automations-'))
  await writeFile(join(rootDir, 'PROMPT-triage.md'), 'Triage the pending threads.', 'utf8')
})

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true })
})

describe('reconcilePluginAutomations', () => {
  it('creates a declared automation disabled, unowned and never reusing a session', async () => {
    const harness = createStore()

    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
      ])
    })

    expect(harness.rows()).toHaveLength(1)
    expect(harness.rows()[0]).toMatchObject({
      name: 'WhatsApp: triage',
      // The prompt is the file's bytes, not the manifest path.
      prompt: 'Triage the pending threads.',
      precheck: { command: 'wa-scope pending', timeoutSeconds: 60 },
      agentId: 'claude',
      rrule: '*/5 8-18 * * 1-5',
      timezone: 'America/Bogota',
      // Nace apagada: un plugin no enciende trabajo automatico por su cuenta.
      enabled: false,
      // Y sin proyecto: el plugin no sabe en que workspace corre.
      projectId: '',
      workspaceMode: 'new_per_run',
      reuseSession: false,
      pluginOrigin: { pluginKey, automationId: 'triage' }
    })
  })

  it('is idempotent, so re-enabling never duplicates a row', async () => {
    const harness = createStore()
    const pluginService = createPluginService([
      { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
    ])

    await reconcilePluginAutomations({ store: harness.store, pluginService })
    await reconcilePluginAutomations({ store: harness.store, pluginService })

    expect(harness.rows()).toHaveLength(1)
  })

  it('keeps a user edit instead of overwriting it on re-enable', async () => {
    const harness = createStore()
    const pluginService = createPluginService([
      { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
    ])
    await reconcilePluginAutomations({ store: harness.store, pluginService })

    const edited = { ...harness.rows()[0]!, name: 'Mi triage', prompt: 'Mi prompt', enabled: true }
    const reopened = createStore([edited])
    await reconcilePluginAutomations({ store: reopened.store, pluginService })

    expect(reopened.rows()).toEqual([edited])
  })

  it('deletes its own rows when the plugin is disabled, and only its own', async () => {
    const userRow = {
      id: 'user-1',
      name: 'Mine',
      pluginOrigin: undefined
    } as unknown as Automation
    const harness = createStore([userRow])
    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
      ])
    })
    expect(harness.rows()).toHaveLength(2)

    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'disabled' }
      ])
    })

    expect(harness.rows()).toEqual([userRow])
  })

  it('deletes rows for a declaration the plugin dropped on update', async () => {
    const harness = createStore()
    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        {
          manifest: manifestWith([triage, { ...triage, id: 'digest', title: 'Digest' }]),
          rootDir,
          activation: 'approved'
        }
      ])
    })
    expect(harness.rows()).toHaveLength(2)

    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
      ])
    })

    expect(harness.rows().map((row) => row.pluginOrigin?.automationId)).toEqual(['triage'])
  })

  it('skips an automation whose prompt file is missing without failing the rest', async () => {
    const harness = createStore()

    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        {
          manifest: manifestWith([
            { ...triage, id: 'gone', title: 'Gone', prompt: 'PROMPT-missing.md' },
            triage
          ]),
          rootDir,
          activation: 'approved'
        }
      ])
    })

    expect(harness.rows().map((row) => row.pluginOrigin?.automationId)).toEqual(['triage'])
  })

  it('refuses a prompt that escapes the plugin directory', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'orca-outside-'))
    await writeFile(join(outside, 'secret.md'), 'secret', 'utf8')
    const harness = createStore()

    await expect(
      // The manifest schema itself rejects the traversal, before any read.
      async () =>
        reconcilePluginAutomations({
          store: harness.store,
          pluginService: createPluginService([
            {
              manifest: manifestWith([{ ...triage, prompt: '../secret.md' }]),
              rootDir,
              activation: 'approved'
            }
          ])
        })
    ).rejects.toThrow()

    expect(harness.rows()).toHaveLength(0)
    await rm(outside, { recursive: true, force: true })
  })
})
