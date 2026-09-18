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

/** Blocks for ~3s without reading stdin, so the run is still in flight while
 *  the assertions below look at everything else. */
const SLOW_COMMAND = 'node -e "setTimeout(()=>{},3000)"'

function createCommandAutomation(
  command: string,
  enabled = false,
  timeoutSeconds = 30
): Automation {
  return store.createAutomation({
    name: 'Sync',
    command: { command, timeoutSeconds },
    projectId: registerWorkDir(),
    workspaceMode: 'new_per_run',
    timezone: 'UTC',
    rrule: '*/5 * * * *',
    dtstart: Date.now(),
    enabled
  })
}

function latestRun(automationId: string): AutomationRun {
  const runs = store.listAutomationRuns(automationId)
  return runs.at(-1) as AutomationRun
}

/** Real-timer poll: the fixtures fake `Date` only, so vitest helpers that drive
 *  fake timers would stall on a child process that settles on I/O. */
async function waitForRun(
  automationId: string,
  predicate: (run: AutomationRun | undefined) => boolean,
  budgetMs = 2000
): Promise<AutomationRun> {
  const deadline = performance.now() + budgetMs
  for (;;) {
    const runs = store.listAutomationRuns(automationId)
    const run = runs.at(-1)
    if (predicate(run)) {
      return run as AutomationRun
    }
    if (performance.now() > deadline) {
      throw new Error(`run for ${automationId} never matched; last status ${run?.status ?? 'none'}`)
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
}

beforeEach(async () => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-command-automation-'))
  workDir = mkdtempSync(join(tmpdir(), 'orca-command-cwd-'))
  store = await createStore()
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
})

describe('command-only automations', () => {
  it('runs the command and records a completed run, with no window attached', async () => {
    const automation = createCommandAutomation('echo synced')
    // Sin `setWebContents` ni dispatcher headless: si necesitara una ventana,
    // esto terminaria en `skipped_unavailable`, que es la falla que evitamos.
    const service = new AutomationService(store)

    await service.runNow(automation.id)

    const stored = await waitForRun(automation.id, (entry) => entry?.status === 'completed')
    expect(stored.commandResult?.exitCode).toBe(0)
    expect(stored.outputSnapshot?.content).toContain('synced')
    expect(stored.error).toBeNull()
  })

  it('records a failing command as a failed run with its exit code, not a skip', async () => {
    const automation = createCommandAutomation('exit 3')
    const service = new AutomationService(store)

    await service.runNow(automation.id)

    const stored = await waitForRun(automation.id, (entry) =>
      Boolean(entry && entry.status !== 'pending' && entry.status !== 'dispatching')
    )
    expect(stored.status).toBe('command_failed')
    expect(stored.status).not.toBe('skipped_precheck')
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

  it('keeps evaluating other automations while one command is still running', async () => {
    // Solo `Date` es falso: el hijo termina por I/O, no por un timer.
    vi.useFakeTimers({ toFake: ['Date'] })
    const slow = createCommandAutomation(SLOW_COMMAND, true)
    const quick = createCommandAutomation('echo quick', true)
    vi.setSystemTime(Date.now() + 6 * 60 * 1000)
    const service = new AutomationService(store)

    service.setRendererReady()

    await waitForRun(quick.id, (entry) => entry?.status === 'completed')
    expect(latestRun(slow.id).status).toBe('dispatching')
  })

  it('does not start a second run while the same automation is still running', async () => {
    const automation = createCommandAutomation(SLOW_COMMAND)
    const service = new AutomationService(store)

    const first = await service.runNow(automation.id)
    const second = await service.runNow(automation.id)

    expect(first.status).toBe('dispatching')
    expect(second.status).toBe('skipped_unavailable')
    expect(second.error).toContain('still running')
  })

  it('does not let a run deleted mid-flight escape as an unhandled rejection', async () => {
    // El comando sobrevive al borrado, asi que el final de la corrida escribe
    // sobre una fila que ya no existe — el store tira y nadie espera esa promesa.
    const automation = createCommandAutomation('node -e "setTimeout(()=>{},400)"')
    const service = new AutomationService(store)
    const escaped: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      escaped.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      await service.runNow(automation.id)
      store.deleteAutomation(automation.id)
      await new Promise<void>((resolve) => setTimeout(resolve, 1500))
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }

    expect(escaped.map((reason) => String(reason))).toEqual([])
  })

  it('skips a scheduled run whose precheck fails, without running the command', async () => {
    // Solo `Date` es falso: el hijo termina por I/O, no por un timer.
    vi.useFakeTimers({ toFake: ['Date'] })
    const automation = store.createAutomation({
      name: 'Sync',
      command: { command: 'echo ran-anyway', timeoutSeconds: 30 },
      precheck: { command: 'exit 7', timeoutSeconds: 30 },
      projectId: registerWorkDir(),
      workspaceMode: 'new_per_run',
      timezone: 'UTC',
      rrule: '*/5 * * * *',
      dtstart: Date.now(),
      enabled: true
    })
    vi.setSystemTime(Date.now() + 6 * 60 * 1000)
    const service = new AutomationService(store)

    // `runNow` marca la corrida como manual y el precheck solo corre en las
    // programadas, asi que la unica forma de tocar esta rama es el scheduler.
    service.setRendererReady()

    const stored = await waitForRun(automation.id, (entry) => entry?.status === 'skipped_precheck')
    expect(stored.precheckResult?.exitCode).toBe(7)
    expect(stored.commandResult ?? null).toBeNull()
    expect(stored.outputSnapshot ?? null).toBeNull()
    expect(stored.error).toContain('7')
  })

  it('records a command that blew its timeout as failed, not completed', async () => {
    const automation = createCommandAutomation(SLOW_COMMAND, false, 1)
    const service = new AutomationService(store)

    await service.runNow(automation.id)

    const stored = await waitForRun(
      automation.id,
      (entry) => Boolean(entry && entry.status !== 'pending' && entry.status !== 'dispatching'),
      6000
    )
    expect(stored.status).toBe('command_failed')
    expect(stored.commandResult?.timedOut).toBe(true)
    expect(stored.error).toMatch(/^Command timed out after \d+s\.$/)
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
