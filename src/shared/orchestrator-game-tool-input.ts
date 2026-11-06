import { stripTerminalControl } from './terminal-control-stripping'

const TOOL_INPUT_MAX = 200

/** A tool input as a one-line preview a card can show; undefined when there is nothing to show. */
export function gameToolInputOf(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const words = stripTerminalControl(value).replace(/\s+/g, ' ').trim()
  return words === '' ? undefined : words.slice(0, TOOL_INPUT_MAX)
}
