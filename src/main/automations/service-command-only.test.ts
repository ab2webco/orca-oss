import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Automation,
  AutomationCreateInput,
  AutomationRun
} from '../../shared/automations-types'
import type { Store } from '../persistence'
import { createStore, testState } from '../persistence-test-harness'
import { AutomationService } from './service'

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

let store: Store
let workDir: string

function registerWorkDir(): string {
  store.addRepo({
    id: 'repo-1',
    path: workDir,
    displayName: 'Scratch',
    badgeColor: '#fff',
    addedAt: 1,
    kind: 'folder'
  })
  return 'repo-1'
}

function createCommandAutomation(command: string): Automation {
  return store.createAutomation({
    name: 'Sync',
    command: { command, timeoutSeconds: 30 },
    projectId: registerWorkDir(),
    workspaceMode: 'new_per_run',
    timezone: 'UTC',
    rrule: '*/5 * * * *',
    dtstart: Date.now(),
    enabled: false
  })
}

function latestRun(automationId: string): AutomationRun {
  const runs = store.listAutomationRuns(automationId)
  return runs.at(-1) as AutomationRun
}

beforeEach(async () => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-command-automation-'))
  workDir = mkdtempSync(join(tmpdir(), 'orca-command-cwd-'))
  store = await createStore()
})

afterEach(() => {
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
})

describe('command-only automations', () => {
  it('runs the command and records a completed run, with no window attached', async () => {
    const automation = createCommandAutomation('echo synced')
    // Sin `setWebContents` ni dispatcher headless: si necesitara una ventana,
    // esto terminaria en `skipped_unavailable`, que es la falla que evitamos.
    const service = new AutomationService(store)

    const run = await service.runNow(automation.id)

    expect(run.status).toBe('completed')
    const stored = latestRun(automation.id)
    expect(stored.commandResult?.exitCode).toBe(0)
    expect(stored.outputSnapshot?.content).toContain('synced')
    expect(stored.error).toBeNull()
  })

  it('records a failing command as a failed run with its exit code, not a skip', async () => {
    const automation = createCommandAutomation('exit 3')
    const service = new AutomationService(store)

    const run = await service.runNow(automation.id)

    expect(run.status).toBe('command_failed')
    expect(run.status).not.toBe('skipped_precheck')
    const stored = latestRun(automation.id)
    expect(stored.commandResult?.exitCode).toBe(3)
    expect(stored.error).toContain('3')
  })

  it('still needs a run target it can resolve', async () => {
    const automation = store.createAutomation({
      name: 'Sync',
      command: { command: 'echo nope', timeoutSeconds: 30 },
      projectId: '',
      workspaceMode: 'new_per_run',
      timezone: 'UTC',
      rrule: '*/5 * * * *',
      dtstart: Date.now(),
      enabled: false
    })

    const run = await new AutomationService(store).runNow(automation.id)

    expect(run.status).toBe('skipped_unavailable')
  })

  it('leaves an agent-backed automation on the window dispatch path', async () => {
    const automation = store.createAutomation({
      name: 'Review',
      prompt: 'Review the open changes.',
      agentId: 'claude',
      projectId: registerWorkDir(),
      workspaceMode: 'new_per_run',
      timezone: 'UTC',
      rrule: '*/5 * * * *',
      dtstart: Date.now(),
      enabled: false
    })

    const run = await new AutomationService(store).runNow(automation.id)

    // Sin ventana ni dispatcher headless el camino del agente no cambia: sigue
    // diciendo que no habia donde lanzarlo.
    expect(run.status).toBe('skipped_unavailable')
    expect(run.error).toContain('window')
  })

  it('refuses a row that would neither run a command nor launch an agent', () => {
    // La union de `AutomationCreateInput` ya lo impide en compilacion — de ahi
    // el cast; esto cubre una carga RPC o un estado persistido deformado.
    const neither = {
      name: 'Nothing',
      projectId: registerWorkDir(),
      workspaceMode: 'new_per_run',
      timezone: 'UTC',
      rrule: '*/5 * * * *',
      dtstart: Date.now()
    } as unknown as AutomationCreateInput

    expect(() => store.createAutomation(neither)).toThrow(/command to run or an agent to launch/)
  })
})
