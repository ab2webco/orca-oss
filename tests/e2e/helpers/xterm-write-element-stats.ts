/**
 * ORCA-251 — reading a run of xterm write elements.
 *
 * Split from the probe because the probe runs in the page and this runs in the
 * test; keeping them together put the file over its line budget.
 */
import type { XtermWriteElement } from './xterm-write-element-cost'

export type XtermWriteElementStats = {
  tag: string
  count: number
  charsTotal: number
  maxChars: number
  /** Elements written at the scheduler's full chunk cap. */
  atCapCount: number
  medianActionMs: number
  p95ActionMs: number
  maxActionMs: number
  actionMsTotal: number
  /** Null when no element carried a callback. */
  medianCallbackMs: number | null
  maxCallbackMs: number | null
  /** What the parse alone sustained, so a reading can be put next to xterm's own claim. */
  parseMbPerSec: number
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0
  }
  return sorted.at(Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))) ?? 0
}

export function summarizeXtermWriteElements(
  elements: XtermWriteElement[],
  capChars: number
): XtermWriteElementStats[] {
  const byTag = new Map<string, XtermWriteElement[]>()
  for (const element of elements) {
    const bucket = byTag.get(element.tag)
    if (bucket) {
      bucket.push(element)
    } else {
      byTag.set(element.tag, [element])
    }
  }
  return [...byTag.entries()].map(([tag, records]) => summarizeTag(tag, records, capChars))
}

function summarizeTag(
  tag: string,
  records: XtermWriteElement[],
  capChars: number
): XtermWriteElementStats {
  const actions = records.map((record) => record.actionMs).sort((a, b) => a - b)
  const callbacks = records
    .map((record) => record.callbackMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)
  const charsTotal = records.reduce((total, record) => total + record.chars, 0)
  const actionMsTotal = actions.reduce((total, value) => total + value, 0)
  return {
    tag,
    count: records.length,
    charsTotal,
    maxChars: records.reduce((max, record) => Math.max(max, record.chars), 0),
    atCapCount: records.filter((record) => record.chars === capChars).length,
    medianActionMs: Number(quantile(actions, 0.5).toFixed(2)),
    p95ActionMs: Number(quantile(actions, 0.95).toFixed(2)),
    maxActionMs: Number((actions.at(-1) ?? 0).toFixed(2)),
    actionMsTotal: Number(actionMsTotal.toFixed(1)),
    medianCallbackMs: callbacks.length ? Number(quantile(callbacks, 0.5).toFixed(2)) : null,
    maxCallbackMs: callbacks.length ? Number((callbacks.at(-1) ?? 0).toFixed(2)) : null,
    parseMbPerSec:
      actionMsTotal > 0 ? Number((charsTotal / 1024 / 1024 / (actionMsTotal / 1000)).toFixed(1)) : 0
  }
}

export function formatXtermWriteStats(stats: XtermWriteElementStats): string {
  return (
    `${stats.tag} elements=${stats.count} chars=${stats.charsTotal} maxChars=${stats.maxChars} ` +
    `atCap=${stats.atCapCount} action median=${stats.medianActionMs}ms p95=${stats.p95ActionMs}ms ` +
    `max=${stats.maxActionMs}ms total=${stats.actionMsTotal}ms parse=${stats.parseMbPerSec}MB/s ` +
    `callback median=${stats.medianCallbackMs}ms max=${stats.maxCallbackMs}ms`
  )
}
