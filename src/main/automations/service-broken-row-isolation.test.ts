import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import type { Store } from '../persistence'
import { createStore, readDataFile, testState, writeDataFile } from '../persistence-test-harness'
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

/** `listAutomations` ordena por nombre, asi que la fila rota va delante de la
 *  sana: con el bucle abortando, la sana nunca llega a evaluarse. */
const BROKEN_NAME = 'A broken'
const HEALTHY_NAME = 'Z healthy'

function seedRow(name: string, extra: Record<string, unknown>): Automation {
  return store.createAutomation({
    name,
    projectId: 'repo-1',
    workspaceMode: 'new_per_run',
    timezone: 'UTC',
    rrule: '*/5 * * * *',
    dtstart: Date.now(),
    enabled: true,
    ...extra
  } as Parameters<Store['createAutomation']>[0])
}

/** Un estado persistido deformado: ni comando ni agente. `createAutomation` lo
 *  rechaza, asi que la unica forma de tenerlo es en disco, que es justo de
 *  donde sale en produccion. */
async function breakStoredRow(name: string): Promise<void> {
  store.flush()
  const data = readDataFile() as { automations: Record<string, unknown>[] }
  for (const row of data.automations) {
    if (row.name === name) {
      row.agentId = null
      row.command = null
    }
  }
  writeDataFile(data)
  store = await createStore()
}

async function waitForRun(
  automationId: string,
  predicate: (run: AutomationRun | undefined) => boolean,
  budgetMs = 4000
): Promise<AutomationRun> {
  const deadline = performance.now() + budgetMs
  for (;;) {
    const run = store.listAutomationRuns(automationId).at(-1)
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
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-automation-isolation-'))
  workDir = mkdtempSync(join(tmpdir(), 'orca-automation-isolation-cwd-'))
  store = await createStore()
  store.addRepo({
    id: 'repo-1',
    path: workDir,
    displayName: 'Scratch',
    badgeColor: '#fff',
    addedAt: 1,
    kind: 'folder'
  })
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(testState.dir, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
})

describe('automation evaluation isolation', () => {
  it('keeps evaluating the rest of the schedule when one row cannot say what it does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    seedRow(BROKEN_NAME, { prompt: 'x', agentId: 'claude' })
    const healthy = seedRow(HEALTHY_NAME, {
      command: { command: 'echo alive', timeoutSeconds: 30 }
    })
    await breakStoredRow(BROKEN_NAME)
    const broken = store.listAutomations().find((row) => row.name === BROKEN_NAME) as Automation
    expect(broken.agentId).toBeNull()
    expect(broken.command ?? null).toBeNull()
    vi.setSystemTime(Date.now() + 6 * 60 * 1000)
    const service = new AutomationService(store)

    service.setRendererReady()

    const run = await waitForRun(healthy.id, (entry) => entry?.status === 'completed')
    expect(run.commandResult?.exitCode).toBe(0)
    // Y la rota no queda muda: deja constancia en vez de desaparecer.
    expect(store.listAutomationRuns(broken.id).at(-1)?.status).toBe('dispatch_failed')
  })
})
