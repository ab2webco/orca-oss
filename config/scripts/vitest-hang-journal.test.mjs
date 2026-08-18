import { describe, expect, it } from 'vitest'

import { summarizeHangJournal } from './vitest-hang-journal.mjs'

function journal(...events) {
  return events.map((event) => JSON.stringify(event)).join('\n')
}

describe('summarizeHangJournal', () => {
  it('names a module that was queued and never started', () => {
    const summary = summarizeHangJournal(
      journal(
        { event: 'run-start', atMs: 0, modules: ['a.test.ts', 'b.test.ts'] },
        { event: 'module-queued', atMs: 1, module: 'a.test.ts' },
        { event: 'module-start', atMs: 2, module: 'a.test.ts' },
        { event: 'module-end', atMs: 3, module: 'a.test.ts' },
        { event: 'module-queued', atMs: 4, module: 'b.test.ts' }
      )
    )
    expect(summary.verdict).toBe('wedged-modules')
    expect(summary.suspects).toEqual([{ module: 'b.test.ts', queuedAtMs: 4, startedAtMs: null }])
    expect(summary.endedCount).toBe(1)
    expect(summary.plannedCount).toBe(2)
  })

  it('reports a module that started as running rather than loading', () => {
    const summary = summarizeHangJournal(
      journal(
        { event: 'run-start', atMs: 0, modules: ['b.test.ts'] },
        { event: 'module-queued', atMs: 1, module: 'b.test.ts' },
        { event: 'module-start', atMs: 2, module: 'b.test.ts' }
      )
    )
    expect(summary.suspects).toEqual([{ module: 'b.test.ts', queuedAtMs: 1, startedAtMs: 2 }])
  })

  it('separates a teardown hang from a wedged module', () => {
    const summary = summarizeHangJournal(
      journal(
        { event: 'run-start', atMs: 0, modules: ['a.test.ts'] },
        { event: 'module-queued', atMs: 1, module: 'a.test.ts' },
        { event: 'module-end', atMs: 2, module: 'a.test.ts' },
        { event: 'run-end', atMs: 3, reason: 'passed' }
      )
    )
    expect(summary.verdict).toBe('teardown-hang')
    expect(summary.runEndReason).toBe('passed')
    expect(summary.suspects).toEqual([])
  })

  it('survives the torn last line a killed writer leaves behind', () => {
    const summary = summarizeHangJournal(
      `${journal(
        { event: 'run-start', atMs: 0, modules: ['a.test.ts'] },
        { event: 'module-queued', atMs: 1, module: 'a.test.ts' }
      )}\n{"event":"module-st`
    )
    expect(summary.verdict).toBe('wedged-modules')
    expect(summary.suspects.map((suspect) => suspect.module)).toEqual(['a.test.ts'])
  })

  it('reports no-journal when the reporter never wrote anything', () => {
    expect(summarizeHangJournal(null).verdict).toBe('no-journal')
    expect(summarizeHangJournal('').verdict).toBe('no-journal')
  })

  it('orders suspects by the time they reached a worker', () => {
    const summary = summarizeHangJournal(
      journal(
        { event: 'run-start', atMs: 0, modules: ['a.test.ts', 'b.test.ts'] },
        { event: 'module-queued', atMs: 9, module: 'b.test.ts' },
        { event: 'module-queued', atMs: 4, module: 'a.test.ts' }
      )
    )
    expect(summary.suspects.map((suspect) => suspect.module)).toEqual(['a.test.ts', 'b.test.ts'])
  })
})
