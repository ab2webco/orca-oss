import { cellWidthOf } from './cell-width'
import { gameStrings } from './game-strings'
import type { Need } from './party'

export type StatusKey = 'working' | 'idle' | 'done' | 'waiting'
export type StatusPart = { key: StatusKey; text: string; isAlert: boolean }
type Counts = Readonly<Record<StatusKey, number>>

export const STATUS_GLYPHS: Readonly<Record<StatusKey, string>> = {
  working: '●',
  idle: '○',
  done: '✓',
  waiting: '▲'
}
const STATUS_ORDER: readonly StatusKey[] = ['working', 'idle', 'done', 'waiting']

/** A heading's name and the count that trails it in every locale ("My PRs 3"). */
export const headingPartsOf = (text: string): { name: string; count: string | undefined } => {
  const match = /^(.*\S)\s+(\d+)$/.exec(text)
  return match === null ? { name: text, count: undefined } : { name: match[1]!, count: match[2] }
}

/** The Panel's status row in `columns` cells: every label, then needs-you's only, then glyphs alone. */
export function statusPartsOf(counts: Counts, columns: number): StatusPart[] {
  const text = gameStrings().text
  const variants = [new Set(STATUS_ORDER), new Set<StatusKey>(['waiting']), new Set<StatusKey>()]
  const partsOf = (labeled: ReadonlySet<StatusKey>): StatusPart[] =>
    STATUS_ORDER.map((key) => ({
      key,
      text: labeled.has(key)
        ? `${STATUS_GLYPHS[key]} ${text[key](counts[key])}`
        : `${STATUS_GLYPHS[key]} ${counts[key]}`,
      isAlert: key === 'waiting' && counts.waiting > 0
    }))
  const widthOf = (parts: StatusPart[]) => cellWidthOf(parts.map((one) => one.text).join(' '))
  const all = variants.map(partsOf)
  return all.find((parts) => widthOf(parts) <= columns) ?? all.at(-1)!
}

/** One callout per member, everything it needs joined in the order the needs came. */
export function needCalloutsOf(needs: readonly Need[]): { name: string; text: string }[] {
  const byName = new Map<string, string[]>()
  for (const need of needs) {
    byName.set(need.name, [...(byName.get(need.name) ?? []), need.text])
  }
  return [...byName].map(([name, texts]) => ({ name, text: texts.join(' · ') }))
}
