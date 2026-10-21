import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryPressurePopupRecord } from './memory-pressure-monitor'
import { createMemoryPressurePopupLog } from './memory-pressure-popup-log'

const RECORD: MemoryPressurePopupRecord = {
  event: 'opened',
  at: 1_700_000_000_000,
  episodeId: 1,
  trigger: 'kernel-pressure',
  source: 'sysctl',
  kernelLevel: 'warn',
  availablePercent: 18.5,
  swapUsedPercent: 85.3,
  minutesToExhaustion: null,
  agentPanes: 2
}

describe('createMemoryPressurePopupLog', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = null
    }
  })

  it('writes one NDJSON line per record and creates nothing until the first one', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'orca-memory-log-'))
    const filePath = path.join(dir, 'logs', 'memory-pressure-warnings.ndjson')
    const log = createMemoryPressurePopupLog(filePath)

    log.close()
    expect(() => readFileSync(filePath, 'utf8')).toThrow()

    const reopened = createMemoryPressurePopupLog(filePath)
    reopened.push(RECORD)
    reopened.push({ ...RECORD, event: 'legacy-would-open', episodeId: null, trigger: null })
    reopened.close()

    const lines = readFileSync(filePath, 'utf8').trim().split('\n')
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      RECORD,
      { ...RECORD, event: 'legacy-would-open', episodeId: null, trigger: null }
    ])
  })

  it('swallows a log that cannot be created', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'orca-memory-log-'))
    const blocker = path.join(dir, 'file')
    const log = createMemoryPressurePopupLog(path.join(blocker, 'x.ndjson'))
    // Why a file as the parent directory: mkdir fails, as it would on a read-only profile.
    writeFileSync(blocker, '')

    expect(() => log.push(RECORD)).not.toThrow()
    expect(() => log.close()).not.toThrow()
  })
})
