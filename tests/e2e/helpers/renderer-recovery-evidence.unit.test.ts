import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  flushQueuedRendererRecoveryEvidence,
  formatRendererRecoveryEvidenceLine,
  queueRendererRecoveryEvidence,
  readRendererRecoveryEvidence,
  reportRendererRecoveryEvidence,
  type RendererRecoveryEvidence
} from './renderer-recovery-evidence'

function crashRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1',
    createdAt: new Date().toISOString(),
    status: 'pending',
    source: 'renderer',
    processType: 'renderer',
    reason: 'oom',
    exitCode: null,
    appVersion: '0.0.0',
    platform: 'linux',
    osRelease: '',
    arch: 'x64',
    electronVersion: '0',
    chromeVersion: '0',
    details: {},
    ...overrides
  }
}

describe('readRendererRecoveryEvidence', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(os.tmpdir(), 'renderer-recovery-evidence-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('reports explicit absence when crash-reports.json was never written', async () => {
    const evidence = await readRendererRecoveryEvidence(userDataDir)

    expect(evidence.rendererCrashRecorded).toBe(false)
    expect(evidence.recoveryReloadConfirmed).toBe(false)
    expect(evidence.recoveryReloadLikely).toBe(false)
    expect(evidence.rendererCrashRecordCount).toBe(0)
    // Why: a silent "no evidence" is exactly the failure mode this module
    // exists to end — the absence must be named, not inferred from an empty result.
    expect(evidence.detail).toContain('did not fire')
    expect(evidence.detail).toContain('crash-reports.json was never written')
  })

  it('reports explicit absence when the file has no renderer-source record', async () => {
    writeFileSync(
      path.join(userDataDir, 'crash-reports.json'),
      JSON.stringify({ reports: [crashRecord({ source: 'child', processType: 'gpu' })] })
    )

    const evidence = await readRendererRecoveryEvidence(userDataDir)

    expect(evidence.rendererCrashRecorded).toBe(false)
    expect(evidence.rendererCrashRecordCount).toBe(0)
    expect(evidence.detail).toContain('did not fire')
    expect(evidence.detail).toContain('no renderer-source crash record')
  })

  it('marks the reload LIKELY when the reason recovers by default', async () => {
    writeFileSync(
      path.join(userDataDir, 'crash-reports.json'),
      JSON.stringify({ reports: [crashRecord({ reason: 'oom' })] })
    )

    const evidence = await readRendererRecoveryEvidence(userDataDir)

    expect(evidence.rendererCrashRecorded).toBe(true)
    expect(evidence.recoveryReloadConfirmed).toBe(false)
    expect(evidence.recoveryReloadLikely).toBe(true)
    expect(evidence.rendererCrashRecordCount).toBe(1)
    expect(evidence.crashReasons).toEqual(['oom'])
    expect(evidence.detail).toContain('LIKELY')
    expect(evidence.detail).toContain('oom')
  })

  it('does not claim the reload for a non-recoverable reason', async () => {
    writeFileSync(
      path.join(userDataDir, 'crash-reports.json'),
      JSON.stringify({ reports: [crashRecord({ reason: 'integrity-failure' })] })
    )

    const evidence = await readRendererRecoveryEvidence(userDataDir)

    expect(evidence.rendererCrashRecorded).toBe(true)
    expect(evidence.recoveryReloadConfirmed).toBe(false)
    expect(evidence.recoveryReloadLikely).toBe(false)
    expect(evidence.detail).toContain('did NOT run')
    expect(evidence.detail).toContain('integrity-failure')
  })

  it('confirms the reload when a renderer_recovery_reload breadcrumb is present', async () => {
    writeFileSync(
      path.join(userDataDir, 'crash-reports.json'),
      JSON.stringify({
        reports: [
          crashRecord({
            reason: 'crashed',
            breadcrumbs: [{ createdAt: new Date().toISOString(), name: 'renderer_recovery_reload' }]
          })
        ]
      })
    )

    const evidence = await readRendererRecoveryEvidence(userDataDir)

    expect(evidence.recoveryReloadConfirmed).toBe(true)
    expect(evidence.recoveryReloadLikely).toBe(false)
    expect(evidence.recoveryBreadcrumbCount).toBe(1)
    expect(evidence.detail).toContain('CONFIRMED')
  })

  it('treats malformed JSON as undetermined, not a thrown error', async () => {
    writeFileSync(path.join(userDataDir, 'crash-reports.json'), '{not json')

    const evidence = await readRendererRecoveryEvidence(userDataDir)

    expect(evidence.rendererCrashRecorded).toBe(false)
    expect(evidence.detail).toContain('undetermined')
  })
})

describe('formatRendererRecoveryEvidenceLine', () => {
  it('embeds the test title and the evidence detail in one grep-able line', async () => {
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'renderer-recovery-evidence-'))
    try {
      const evidence = await readRendererRecoveryEvidence(userDataDir)
      const line = formatRendererRecoveryEvidenceLine('my spec > my test', evidence)

      expect(line).toContain('[renderer-recovery-evidence]')
      expect(line).toContain('my spec > my test')
      expect(line).toContain(evidence.detail)
    } finally {
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})

type FakeTestInfo = {
  status: string
  titlePath: string[]
  attach: (name: string, options?: { body?: string | Buffer }) => Promise<void>
}

function fakeTestInfo(status: string): {
  testInfo: FakeTestInfo
  attachCalls: { name: string; body: string }[]
} {
  const attachCalls: { name: string; body: string }[] = []
  const testInfo: FakeTestInfo = {
    status,
    titlePath: ['spec.ts', 'suite', 'test'],
    attach: async (name, options) => {
      attachCalls.push({ name, body: String(options?.body ?? '') })
    }
  }
  return { testInfo, attachCalls }
}

describe('reportRendererRecoveryEvidence', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(os.tmpdir(), 'renderer-recovery-evidence-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('skips work on a passed test', async () => {
    const { testInfo, attachCalls } = fakeTestInfo('passed')
    await reportRendererRecoveryEvidence(
      userDataDir,
      testInfo as unknown as Parameters<typeof reportRendererRecoveryEvidence>[1]
    )
    expect(attachCalls).toHaveLength(0)
  })

  it('reports on a failed test', async () => {
    const { testInfo, attachCalls } = fakeTestInfo('failed')
    await reportRendererRecoveryEvidence(
      userDataDir,
      testInfo as unknown as Parameters<typeof reportRendererRecoveryEvidence>[1]
    )
    expect(attachCalls).toHaveLength(1)
    expect(attachCalls[0].name).toBe('renderer-recovery-evidence.json')
    expect(attachCalls[0].body).toContain('did not fire')
  })
})

describe('queueRendererRecoveryEvidence / flushQueuedRendererRecoveryEvidence', () => {
  // Why this pair matters: a prior version of this fix used
  // reportRendererRecoveryEvidence(..., { force: true }) from dispose(),
  // which reports unconditionally — including on every PASSING test using
  // orca-restart.ts/paired-electron-client.ts. That is the exact defect this
  // suite exists to catch: both directions must hold, not just "it reports
  // on failure".
  function evidence(): RendererRecoveryEvidence {
    return {
      rendererCrashRecorded: false,
      recoveryReloadConfirmed: false,
      recoveryReloadLikely: false,
      crashReasons: [],
      rendererCrashRecordCount: 0,
      recoveryBreadcrumbCount: 0,
      detail: 'renderer_recovery_reload: did not fire — test fixture evidence.'
    }
  }

  it('reports queued evidence once status is finalized as failed', async () => {
    const { testInfo, attachCalls } = fakeTestInfo('passed')
    const asTestInfo = testInfo as unknown as Parameters<typeof queueRendererRecoveryEvidence>[0]
    // Why status starts 'passed' then flips: this mirrors the real timing —
    // queuing happens mid-test (status not yet finalized), Playwright then
    // finalizes status once the test function's promise settles, and only
    // then does the auto fixture's teardown call flush.
    queueRendererRecoveryEvidence(asTestInfo, evidence())
    testInfo.status = 'failed'
    await flushQueuedRendererRecoveryEvidence(asTestInfo)
    expect(attachCalls).toHaveLength(1)
    expect(attachCalls[0].name).toBe('renderer-recovery-evidence.json')
  })

  it('does not report queued evidence when the test ends up passing', async () => {
    const { testInfo, attachCalls } = fakeTestInfo('passed')
    const asTestInfo = testInfo as unknown as Parameters<typeof queueRendererRecoveryEvidence>[0]
    queueRendererRecoveryEvidence(asTestInfo, evidence())
    // status stays 'passed' — the test that queued this evidence recovered
    // or never actually failed.
    await flushQueuedRendererRecoveryEvidence(asTestInfo)
    expect(attachCalls).toHaveLength(0)
  })

  it('is a no-op when nothing was queued', async () => {
    const { testInfo, attachCalls } = fakeTestInfo('failed')
    const asTestInfo = testInfo as unknown as Parameters<typeof queueRendererRecoveryEvidence>[0]
    await flushQueuedRendererRecoveryEvidence(asTestInfo)
    expect(attachCalls).toHaveLength(0)
  })
})
