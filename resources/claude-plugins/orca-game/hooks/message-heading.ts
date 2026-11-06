import type { ScenePhase } from '../types'
import { shortMemberNameOf } from './member-character'
import type { MessageHeadingWords, ToolKind } from './message-heading-words'

/** The heading row over a message: who speaks, then its phase or that it asks the person. */
export const messageHeadingOf = (
  name: string,
  phase: ScenePhase,
  isQuestion: boolean,
  words: MessageHeadingWords
): string => `${name} · ${isQuestion ? words.asksYou : words.phases[phase]}`

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
