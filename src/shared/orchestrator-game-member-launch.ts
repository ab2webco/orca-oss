import { stripTerminalControl } from './terminal-control-stripping'

/** Where a member's model came from without Jev: its own hooks (`session`) or Orca's launch choice. */
export type GameMemberModelSource = 'session' | 'launch'

/** The model and effort Orca launched a dispatched member on, as a person reads them. */
export type GameMemberLaunch = {
  model: string | null
  effort: string | null
  /** Absent from an older host, which named no source (ORCA-933). */
  source?: GameMemberModelSource
}

const MODEL_SOURCES: readonly GameMemberModelSource[] = ['session', 'launch']

const WORDS_MAX = 64
const CLAUDE_FAMILY = /^claude-([a-z]+)((?:-\d{1,2})*)(?:-\d{8})?(?:\[[^\]]*\])?$/
const ALIAS = /^[a-z]+$/

const capitalized = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

// Why our own: a launch receipt holds the CLI id (`claude-opus-5-5`), which no catalog labels.
const modelLabelOf = (model: string): string => {
  const [, family, digits = ''] = CLAUDE_FAMILY.exec(model) ?? []
  if (family !== undefined) {
    const version = digits.split('-').filter(Boolean).join('.')
    return version === '' ? capitalized(family) : `${capitalized(family)} ${version}`
  }
  return ALIAS.test(model) ? capitalized(model) : model
}

const wordsOf = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const words = stripTerminalControl(value).replace(/\s+/g, ' ').trim()
  return words === '' ? null : words.slice(0, WORDS_MAX)
}

/** A worker dispatch's `effective` launch selection; null when it chose neither or is unreadable. */
export function gameMemberLaunchOf(value: unknown): GameMemberLaunch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const selection = value as Record<string, unknown>
  const model = wordsOf(selection.model)
  const effort = wordsOf(selection.effort)
  if (model === undefined || effort === undefined || (model === null && effort === null)) {
    return null
  }
  const source = MODEL_SOURCES.find((one) => one === selection.source)
  return {
    model: model === null ? null : modelLabelOf(model),
    effort,
    ...(source ? { source } : {})
  }
}
