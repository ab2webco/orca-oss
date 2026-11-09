import type { ScenePhase } from '../types'
import { cellWidthOf } from './cell-width'
import { shortMemberNameOf } from './member-character'
import type { MessageHeadingWords, ToolKind } from './message-heading-words'

/** The heading row over a message: who speaks, then its phase or that it asks the person. */
export const messageHeadingOf = (
  name: string,
  phase: ScenePhase,
  isQuestion: boolean,
  words: MessageHeadingWords
): string => `${name} · ${isQuestion ? words.asksYou : words.phases[phase]}`

const MINUTE_MS = 60_000
const RULE_MIN = 3

/** How far into its turn a block was written: `0:06` under a minute, then `10 min`, `1 h 5 min`. */
export const headingTimeOf = (elapsedMs: number): string => {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  if (seconds < 60) {
    return `0:${String(seconds).padStart(2, '0')}`
  }
  const minutes = Math.floor(elapsedMs / MINUTE_MS)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) {
    return `${minutes} min`
  }
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
}

export type HeadingFit = { rule: number; isTimeShown: boolean }

// Why one column spare: a row that fills the last column wraps on some terminals.
// Why the rule goes first, then the time: a wrapped heading breaks mid-word.
/** Cells of the rule between a heading and its time, a space either side; 0 when it has no room. */
export const headingFitOf = (label: string, time: string, columns: number): HeadingFit => {
  const room = columns - 1 - cellWidthOf(label)
  const timeCells = time === '' ? 0 : cellWidthOf(time) + 1
  const rule = room - 1 - timeCells
  return rule >= RULE_MIN
    ? { rule, isTimeShown: time !== '' }
    : { rule: 0, isTimeShown: time !== '' && room >= timeCells }
}

/** A member's character, a lead's title, else the phase card's name. */
export const headingNameOf = (hero: string | undefined, cardName: string): string =>
  hero === undefined || hero.trim() === '' ? cardName : shortMemberNameOf(hero)

// Why the last line only: a question asked and answered mid-block does not wait on the person.
export const isQuestionToPerson = (markdown: string): boolean => {
  const last = markdown.trimEnd().split('\n').at(-1) ?? ''
  return /[?？]$/.test(last.replace(/[\s*_`)"'»”]+$/u, ''))
}

const kindOf = (tool: string): ToolKind => {
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
      return 'read'
    case 'Bash':
    case 'PowerShell':
      return 'command'
    case 'Grep':
    case 'Glob':
      return 'search'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    default:
      return 'other'
  }
}

/** A collapsed group's one line: each kind counted, in the order first called. */
export const toolSummaryOf = (
  calls: readonly { tool: string }[],
  words: MessageHeadingWords
): string => {
  const counts = new Map<ToolKind, number>()
  for (const call of calls) {
    const kind = kindOf(call.tool)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const line = [...counts].map(([kind, count]) => words.toolCounts[kind](count)).join(', ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}
