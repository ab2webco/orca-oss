import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatRendererRecoveryEvidenceLine,
  readRendererRecoveryEvidence
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
