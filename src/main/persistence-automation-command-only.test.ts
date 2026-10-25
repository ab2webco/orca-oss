import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AutomationCreateInput } from '../shared/automations-types'
import { testState, createStore, writeDataFile, makeRepo } from './persistence-test-harness'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('./telemetry/client', () => ({
  track: vi.fn()
}))

vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))

const schedule = {
  timezone: 'UTC',
  rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
  dtstart: new Date('2026-05-13T00:00:00Z').getTime()
}

describe('Store automations: command-only rows and pane targets', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('drops agent, workspace, session, pane and account pins from a command-only row', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())

    const automation = store.createAutomation({
      name: 'Backup',
      command: { command: 'echo ok', timeoutSeconds: 30 },
      projectId: 'r1',
      workspaceMode: 'existing',
      workspaceId: 'wt1',
      reuseSession: true,
      targetPaneKey: 'tab-1:leaf-1',
      claudeAccountId: 'account-a',
      ...schedule
    })

    expect(automation).toMatchObject({
      agentId: null,
      command: { command: 'echo ok', timeoutSeconds: 30 },
      workspaceId: null,
      reuseSession: false,
      targetPaneKey: null,
      claudeAccountId: null,
      codexAccountId: null
    })
  })

  it('runs the command when a legacy payload declares both a command and an agent', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())
    const legacyPayload = {
      name: 'Legacy',
      prompt: 'Summarize',
      agentId: 'claude',
      command: { command: 'echo ok', timeoutSeconds: 30 },
      projectId: 'r1',
      workspaceMode: 'new_per_run',
      ...schedule
    } as unknown as AutomationCreateInput

    expect(store.createAutomation(legacyPayload).agentId).toBeNull()
  })

  it('keeps a pane target only while the row reuses a session in an existing workspace', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())

    const reusing = store.createAutomation({
      name: 'Digest',
      prompt: 'Summarize',
      agentId: 'claude',
      projectId: 'r1',
      workspaceMode: 'existing',
      workspaceId: 'wt1',
      reuseSession: true,
      targetPaneKey: 'tab-1:leaf-1',
      ...schedule
    })
    const fresh = store.createAutomation({
      name: 'Fresh',
      prompt: 'Run checks',
      agentId: 'claude',
      projectId: 'r1',
      workspaceMode: 'existing',
      workspaceId: 'wt1',
      targetPaneKey: 'tab-1:leaf-1',
      ...schedule
    })

    expect(reusing.targetPaneKey).toBe('tab-1:leaf-1')
    expect(fresh.targetPaneKey).toBeNull()
  })

  it('drops the pane target when the automation moves to another workspace', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())
    const automation = store.createAutomation({
      name: 'Digest',
      prompt: 'Summarize',
      agentId: 'claude',
      projectId: 'r1',
      workspaceMode: 'existing',
      workspaceId: 'wt1',
      reuseSession: true,
      targetPaneKey: 'tab-1:leaf-1',
      ...schedule
    })

    expect(store.updateAutomation(automation.id, { name: 'Renamed' }).targetPaneKey).toBe(
      'tab-1:leaf-1'
    )
    expect(store.updateAutomation(automation.id, { workspaceId: 'wt2' }).targetPaneKey).toBeNull()
  })

  it('hides a persisted pane target on a row that no longer reuses its session', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [makeRepo()],
      automations: [
        {
          id: 'auto-1',
          name: 'Digest',
          prompt: 'Summarize',
          precheck: null,
          agentId: 'claude',
          projectId: 'r1',
          executionTargetType: 'local',
          executionTargetId: 'local',
          workspaceMode: 'existing',
          workspaceId: 'wt1',
          baseBranch: null,
          reuseSession: false,
          targetPaneKey: 'tab-1:leaf-1',
          enabled: true,
          nextRunAt: 0,
          missedRunPolicy: 'run_once_within_grace',
          missedRunGraceMinutes: 720,
          createdAt: 0,
          updatedAt: 0,
          ...schedule
        }
      ]
    })
    const store = await createStore()

    expect(store.listAutomations()[0]?.targetPaneKey).toBeNull()
  })
})
