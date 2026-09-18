import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput
} from '../../shared/automations-types'
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
  updateCount: () => number
} {
  let rows = [...initial]
  let nextId = 1
  let updates = 0
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
    updateAutomation: (id: string, patch: AutomationUpdateInput): Automation => {
      const index = rows.findIndex((row) => row.id === id)
      if (index === -1) {
        throw new Error('Automation not found.')
      }
      updates += 1
      const updated = { ...rows[index]!, ...patch } as Automation
      rows = rows.map((row, position) => (position === index ? updated : row))
      return updated
    },
    deleteAutomation: (id: string) => {
      rows = rows.filter((row) => row.id !== id)
    }
  } as unknown as Store
  return { store, rows: () => rows, updateCount: () => updates }
}

function createPluginService(
  plugins: { manifest: PluginManifest; rootDir: string; activation: 'approved' | 'disabled' }[]
): PluginService {
  const activationByKey = new Map(plugins.map((entry) => [entry.rootDir, entry.activation]))
  return {
    options: { userDataPath: rootDir },
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

    // Los valores quedan intactos; lo unico que cambia es el acta de que ya no
    // siguen al plugin, que es lo que `orca automations show` imprime.
    expect(reopened.rows()).toEqual([
      {
        ...edited,
        pluginOrigin: { ...edited.pluginOrigin, userEditedFields: ['name', 'prompt'] }
      }
    ])
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
  it('refreshes the prompt when the plugin rewrites the file and nobody edited the row', async () => {
    const harness = createStore()
    const pluginService = createPluginService([
      { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
    ])
    await reconcilePluginAutomations({ store: harness.store, pluginService })

    // El caso real: el plugin arregla su prompt y la fila guardada tenia el viejo.
    await writeFile(join(rootDir, 'PROMPT-triage.md'), 'Resolve tool paths at run time.', 'utf8')
    await reconcilePluginAutomations({ store: harness.store, pluginService })

    expect(harness.rows()).toHaveLength(1)
    expect(harness.rows()[0]?.prompt).toBe('Resolve tool paths at run time.')
    expect(harness.rows()[0]?.pluginOrigin?.userEditedFields).toBeUndefined()
  })

  it('refreshes the title, provider, schedule and precheck command the plugin changed', async () => {
    const harness = createStore()
    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
      ])
    })

    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        {
          manifest: manifestWith([
            {
              ...triage,
              title: 'WhatsApp: triage v2',
              precheck: 'wa-scope pending --strict',
              provider: 'codex',
              trigger: '*/10 8-18 * * 1-5',
              timezone: 'America/New_York'
            }
          ]),
          rootDir,
          activation: 'approved'
        }
      ])
    })

    expect(harness.rows()[0]).toMatchObject({
      name: 'WhatsApp: triage v2',
      precheck: { command: 'wa-scope pending --strict', timeoutSeconds: 60 },
      agentId: 'codex',
      rrule: '*/10 8-18 * * 1-5',
      timezone: 'America/New_York'
    })
  })

  it('keeps the precheck timeout the user chose while refreshing its command', async () => {
    const harness = createStore()
    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
      ])
    })
    // El timeout no lo declara el plugin: cambiarlo no detiene el refresco del comando.
    const retimed = {
      ...harness.rows()[0]!,
      precheck: { command: 'wa-scope pending', timeoutSeconds: 300 }
    }
    const reopened = createStore([retimed])

    await reconcilePluginAutomations({
      store: reopened.store,
      pluginService: createPluginService([
        {
          manifest: manifestWith([{ ...triage, precheck: 'wa-scope pending --strict' }]),
          rootDir,
          activation: 'approved'
        }
      ])
    })

    expect(reopened.rows()[0]?.precheck).toEqual({
      command: 'wa-scope pending --strict',
      timeoutSeconds: 300
    })
  })

  it('clears the precheck when the plugin stops declaring one', async () => {
    const harness = createStore()
    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
      ])
    })
    const { precheck: _declared, ...withoutPrecheck } = triage

    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([withoutPrecheck]), rootDir, activation: 'approved' }
      ])
    })

    expect(harness.rows()[0]?.precheck).toBeNull()
  })

  it('leaves the project, workspace and enabled state alone while refreshing the prompt', async () => {
    const harness = createStore()
    const pluginService = createPluginService([
      { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
    ])
    await reconcilePluginAutomations({ store: harness.store, pluginService })
    const attached = {
      ...harness.rows()[0]!,
      projectId: 'repo-1',
      workspaceId: 'workspace-1',
      workspaceMode: 'existing' as const,
      enabled: true,
      missedRunGraceMinutes: 30
    }
    const reopened = createStore([attached])
    await writeFile(join(rootDir, 'PROMPT-triage.md'), 'Resolve tool paths at run time.', 'utf8')

    await reconcilePluginAutomations({ store: reopened.store, pluginService })

    expect(reopened.rows()[0]).toMatchObject({
      prompt: 'Resolve tool paths at run time.',
      projectId: 'repo-1',
      workspaceId: 'workspace-1',
      workspaceMode: 'existing',
      enabled: true,
      missedRunGraceMinutes: 30
    })
  })

  it('refreshes a field the user never touched even when another one is edited', async () => {
    const harness = createStore()
    const pluginService = createPluginService([
      { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
    ])
    await reconcilePluginAutomations({ store: harness.store, pluginService })
    const renamed = { ...harness.rows()[0]!, name: 'Mi triage' }
    const reopened = createStore([renamed])
    await writeFile(join(rootDir, 'PROMPT-triage.md'), 'Resolve tool paths at run time.', 'utf8')

    await reconcilePluginAutomations({ store: reopened.store, pluginService })

    expect(reopened.rows()[0]).toMatchObject({
      name: 'Mi triage',
      prompt: 'Resolve tool paths at run time.'
    })
    expect(reopened.rows()[0]?.pluginOrigin?.userEditedFields).toEqual(['name'])
  })

  it('refreshes a row created before the fingerprints existed', async () => {
    // Sin huella no hay forma de saber si el usuario la edito: se la trata como
    // no editada, que es justo la fila con el prompt viejo a arreglar.
    const legacy = {
      id: 'legacy-1',
      name: 'WhatsApp: triage',
      prompt: 'Run ./bin/wa-scope pending',
      precheck: { command: 'wa-scope pending', timeoutSeconds: 120 },
      agentId: 'claude',
      projectId: 'repo-1',
      workspaceMode: 'new_per_run',
      workspaceId: null,
      rrule: '*/5 8-18 * * 1-5',
      timezone: 'America/Bogota',
      enabled: true,
      pluginOrigin: { pluginKey, automationId: 'triage' }
    } as unknown as Automation
    const harness = createStore([legacy])

    await reconcilePluginAutomations({
      store: harness.store,
      pluginService: createPluginService([
        { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
      ])
    })

    expect(harness.rows()).toHaveLength(1)
    expect(harness.rows()[0]).toMatchObject({
      id: 'legacy-1',
      prompt: 'Triage the pending threads.',
      projectId: 'repo-1',
      enabled: true
    })
    expect(harness.rows()[0]?.pluginOrigin?.managedFingerprints?.prompt).toEqual(expect.any(String))
    expect(harness.rows()[0]?.pluginOrigin?.userEditedFields).toBeUndefined()
  })

  it('keeps the stored prompt when the plugin prompt file becomes unreadable', async () => {
    const harness = createStore()
    const pluginService = createPluginService([
      { manifest: manifestWith([triage]), rootDir, activation: 'approved' }
    ])
    await reconcilePluginAutomations({ store: harness.store, pluginService })
    // Refrescar con un archivo ilegible borraria el prompt que si funcionaba.
    await rm(join(rootDir, 'PROMPT-triage.md'))

    await reconcilePluginAutomations({ store: harness.store, pluginService })

    expect(harness.rows()).toHaveLength(1)
    expect(harness.rows()[0]?.prompt).toBe('Triage the pending threads.')
    expect(harness.updateCount()).toBe(0)
  })

  it('does not rewrite a row whose declaration did not change', async () => {
    const harness = createStore()
    // El titulo con espacios prueba que la huella cubre los bytes guardados y
    // no los declarados en crudo: si no, cada reconciliacion veria una edicion.
    const pluginService = createPluginService([
      {
        manifest: manifestWith([{ ...triage, title: '  WhatsApp: triage  ' }]),
        rootDir,
        activation: 'approved'
      }
    ])

    await reconcilePluginAutomations({ store: harness.store, pluginService })
    await reconcilePluginAutomations({ store: harness.store, pluginService })
    await reconcilePluginAutomations({ store: harness.store, pluginService })

    expect(harness.rows()[0]?.name).toBe('WhatsApp: triage')
    expect(harness.updateCount()).toBe(0)
  })
})
