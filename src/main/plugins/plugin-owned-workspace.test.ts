import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema, type PluginManifest } from '../../shared/plugins/plugin-manifest'
import { resolveAutomationRunTarget } from '../automations/run-target-resolution'
import type { Store } from '../persistence'
import { createStore, testState } from '../persistence-test-harness'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import type { PluginService } from './plugin-service'
import { reconcilePluginAutomations } from './plugin-automation-reconciliation'
import { applyPluginEnablement } from './plugin-enablement'
import { getPluginWorkspaceDir } from './plugin-owned-workspace'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const pluginKey = 'orca-samples.wa'

const sync = {
  id: 'sync',
  title: 'WhatsApp: sync',
  trigger: '*/5 * * * *',
  timezone: 'America/Bogota',
  prompt: 'PROMPT-sync.md',
  provider: 'claude'
}

function manifestWith(automations: readonly Record<string, unknown>[]): PluginManifest {
  return pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'wa',
    publisher: 'orca-samples',
    name: 'WhatsApp',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { automations },
    capabilities: []
  })
}

function pluginServiceWith(manifest: PluginManifest, rootDir: string): PluginService {
  return {
    options: { userDataPath: testState.dir },
    getDiscovered: (): ValidDiscoveredPlugin[] => [
      {
        pluginKey,
        rootDir,
        manifest,
        consentFingerprint: 'sha256-current',
        contentHash: null,
        isDev: true
      }
    ],
    activationState: () => 'approved',
    findValidPlugin: () => ({ pluginKey, consentFingerprint: 'sha256-current' }),
    reconcileActivationState: () => Promise.resolve()
  } as unknown as PluginService
}

let rootDir: string
let store: Store

beforeEach(async () => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-plugin-workspace-'))
  rootDir = await mkdtemp(join(tmpdir(), 'orca-plugin-root-'))
  await writeFile(join(rootDir, 'PROMPT-sync.md'), 'Sync the pending threads.', 'utf8')
  store = await createStore()
})

afterEach(() => {
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(rootDir, { recursive: true, force: true })
})

describe('plugin-owned automation workspace', () => {
  it('gives an opted-in declaration a target that really resolves, in a directory it created', async () => {
    const pluginService = pluginServiceWith(
      manifestWith([{ ...sync, workspace: 'plugin-owned' }]),
      rootDir
    )

    await reconcilePluginAutomations({ store, pluginService })

    const workspaceDir = getPluginWorkspaceDir(testState.dir, pluginKey)
    expect(statSync(workspaceDir).isDirectory()).toBe(true)
    const [automation] = store.listAutomations()
    // Sigue naciendo apagada: tener donde correr no es permiso para correr.
    expect(automation.enabled).toBe(false)
    expect(automation.reuseSession).toBe(false)
    // El destino se valida por el camino de siempre, no por una asercion
    // estructural: esto es exactamente lo que fallaba con `projectId: ''`.
    const target = resolveAutomationRunTarget(store, automation)
    expect(target).toMatchObject({ ok: true, cwd: workspaceDir })
    // Y se lee como lo que es, no como un proyecto desconocido.
    expect(store.getRepo(automation.projectId)).toMatchObject({
      displayName: 'WhatsApp (plugin)',
      kind: 'folder'
    })
  })

  it('creates a command-only declaration with no agent and no prompt', async () => {
    const pluginService = pluginServiceWith(
      manifestWith([
        {
          id: 'sync',
          title: 'WhatsApp: sync',
          trigger: '*/5 * * * *',
          timezone: 'America/Bogota',
          command: 'wa-inbox sync --quiet',
          workspace: 'plugin-owned'
        }
      ]),
      rootDir
    )

    await reconcilePluginAutomations({ store, pluginService })

    const [automation] = store.listAutomations()
    expect(automation.agentId).toBeNull()
    expect(automation.command?.command).toBe('wa-inbox sync --quiet')
    expect(automation.prompt).toBe('')
    expect(automation.enabled).toBe(false)
    expect(resolveAutomationRunTarget(store, automation)).toMatchObject({
      ok: true,
      cwd: getPluginWorkspaceDir(testState.dir, pluginKey)
    })
  })

  it('leaves a declaration that does not opt in exactly as before', async () => {
    const pluginService = pluginServiceWith(manifestWith([sync]), rootDir)

    await reconcilePluginAutomations({ store, pluginService })

    const [automation] = store.listAutomations()
    expect(automation.projectId).toBe('')
    expect(resolveAutomationRunTarget(store, automation).ok).toBe(false)
    expect(store.getRepos()).toHaveLength(0)
  })

  it('registers the workspace once, however often the plugin is re-enabled', async () => {
    const pluginService = pluginServiceWith(
      manifestWith([{ ...sync, workspace: 'plugin-owned' }]),
      rootDir
    )

    await reconcilePluginAutomations({ store, pluginService })
    await reconcilePluginAutomations({ store, pluginService })

    expect(store.listAutomations()).toHaveLength(1)
    expect(store.getRepos()).toHaveLength(1)
  })

  it('registers one workspace and one row when two reconciles overlap', async () => {
    // Habilitar por IPC y por el RPC de serve llegan aca a la vez: sin
    // serializar, las dos leen el store vacio y las dos crean lo suyo.
    const pluginService = pluginServiceWith(
      manifestWith([{ ...sync, workspace: 'plugin-owned' }]),
      rootDir
    )

    await Promise.all([
      reconcilePluginAutomations({ store, pluginService }),
      reconcilePluginAutomations({ store, pluginService })
    ])

    expect(store.getRepos()).toHaveLength(1)
    expect(store.listAutomations()).toHaveLength(1)
  })

  it('keeps a project the user picked instead of dragging the row back to the plugin folder', async () => {
    const pluginService = pluginServiceWith(
      manifestWith([{ ...sync, workspace: 'plugin-owned' }]),
      rootDir
    )
    await reconcilePluginAutomations({ store, pluginService })
    const mine = {
      id: 'repo-mine',
      path: join(testState.dir, 'mine'),
      displayName: 'Mine',
      badgeColor: '#fff',
      addedAt: 1,
      kind: 'folder' as const
    }
    store.addRepo(mine)
    const [created] = store.listAutomations()
    store.updateAutomation(created.id, { projectId: mine.id })

    await reconcilePluginAutomations({ store, pluginService })

    const [automation] = store.listAutomations()
    expect(automation.projectId).toBe(mine.id)
    expect(automation.pluginOrigin?.userEditedFields).toContain('runTarget')
  })

  it('does not claim a project the user picked before this feature existed', async () => {
    // Una fila legada: sin huellas, ya apuntada por el usuario a mano.
    const pluginService = pluginServiceWith(
      manifestWith([{ ...sync, workspace: 'plugin-owned' }]),
      rootDir
    )
    const mine = {
      id: 'repo-mine',
      path: join(testState.dir, 'mine'),
      displayName: 'Mine',
      badgeColor: '#fff',
      addedAt: 1,
      kind: 'folder' as const
    }
    store.addRepo(mine)
    const legacy = store.createAutomation({
      name: 'WhatsApp: sync',
      prompt: 'Sync the pending threads.',
      agentId: 'claude',
      projectId: mine.id,
      workspaceMode: 'new_per_run',
      timezone: 'America/Bogota',
      rrule: '*/5 * * * *',
      dtstart: Date.now(),
      enabled: false,
      pluginOrigin: { pluginKey, automationId: 'sync' }
    })

    await reconcilePluginAutomations({ store, pluginService })

    expect(store.listAutomations().find((row) => row.id === legacy.id)?.projectId).toBe(mine.id)
  })
})

describe('telling the renderer the plugin workspace exists', () => {
  // El catalogo de repos del renderer solo se refresca con `repos:changed`, y
  // registrar la carpeta no pasa por ningun camino que lo emita: sin este
  // aviso la fila se queda en "todavia sin proyecto" hasta reiniciar.
  it('avisa cuando registra la carpeta y se calla en la pasada que ya la encuentra', async () => {
    const pluginService = pluginServiceWith(
      manifestWith([{ ...sync, workspace: 'plugin-owned' }]),
      rootDir
    )
    const onReposChanged = vi.fn()

    await applyPluginEnablement({ store, pluginService, pluginKey, enabled: true, onReposChanged })
    expect(onReposChanged).toHaveBeenCalledTimes(1)

    await applyPluginEnablement({ store, pluginService, pluginKey, enabled: true, onReposChanged })
    expect(onReposChanged).toHaveBeenCalledTimes(1)
    expect(store.getRepos()).toHaveLength(1)
  })

  it('no avisa por una declaracion que no pide carpeta', async () => {
    const pluginService = pluginServiceWith(manifestWith([sync]), rootDir)
    const onReposChanged = vi.fn()

    await applyPluginEnablement({ store, pluginService, pluginKey, enabled: true, onReposChanged })

    expect(onReposChanged).not.toHaveBeenCalled()
    expect(store.getRepos()).toHaveLength(0)
  })
})
