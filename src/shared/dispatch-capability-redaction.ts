import type { TerminalLineSegment } from './terminal-line-segments'

// Why no length floor, unlike the transcript's: status text is cut at 160 chars, so a line can hold only a token's head.
const DISPATCH_CAPABILITY = /dcap_[A-Za-z0-9_-]+/g

/** A worker's own command lines carry its capability, a bearer secret no row may show. */
export const redactDispatchCapability = (text: string): string =>
  text.includes('dcap_') ? text.replace(DISPATCH_CAPABILITY, '[redacted]') : text

export const redactOptionalDispatchCapability = <T extends string | undefined>(text: T): T =>
  (text === undefined ? text : redactDispatchCapability(text)) as T

type AgentStatusText = {
  prompt?: string
  toolInput?: string
  interactivePrompt?: string
  lastAssistantMessage?: string
  subagents?: readonly { description?: string }[]
}

/** Every agent text a status payload carries, redacted where it enters Orca so no surface can forget it. */
export function redactAgentStatusText<T extends AgentStatusText>(payload: T): T {
  const fields = [
    payload.prompt,
    payload.toolInput,
    payload.interactivePrompt,
    payload.lastAssistantMessage,
    ...(payload.subagents ?? []).map((one) => one.description)
  ]
  if (!fields.some((text) => text?.includes('dcap_'))) {
    return payload
  }
  return {
    ...payload,
    prompt: redactOptionalDispatchCapability(payload.prompt),
    toolInput: redactOptionalDispatchCapability(payload.toolInput),
    interactivePrompt: redactOptionalDispatchCapability(payload.interactivePrompt),
    lastAssistantMessage: redactOptionalDispatchCapability(payload.lastAssistantMessage),
    ...(payload.subagents
      ? {
          subagents: payload.subagents.map((one) =>
            one.description?.includes('dcap_')
              ? { ...one, description: redactDispatchCapability(one.description) }
              : one
          )
        }
      : {})
  }
}

/**
 * A screen row is cut at the terminal width, so a token can wrap onto the next row. Rows as long as the
 * longest one read are taken as wrapped and redacted as one line; the token's tail on later rows goes.
 */
export function redactWrappedTerminalRows(rows: readonly string[]): string[] {
  const width = Math.max(0, ...rows.map((row) => row.length))
  const groups: string[][] = []
  for (let start = 0; start < rows.length; ) {
    let end = start
    while (end < rows.length - 1 && rows[end].length === width) {
      end++
    }
    groups[groups.length] = redactAcrossRows(rows.slice(start, end + 1))
    start = end + 1
  }
  return groups.flat()
}

function redactAcrossRows(rows: readonly string[]): string[] {
  const joined = rows.join('')
  const matches = Array.from(joined.matchAll(DISPATCH_CAPABILITY), (match) => ({
    start: match.index,
    end: match.index + match[0].length
  }))
  if (matches.length === 0) {
    return [...rows]
  }
  let offset = 0
  return rows.map((row) => {
    let shown = ''
    for (let index = offset; index < offset + row.length; index++) {
      const match = matches.find((one) => index >= one.start && index < one.end)
      if (!match) {
        shown += joined[index]
      } else if (index === match.start) {
        shown += '[redacted]'
      }
    }
    offset += row.length
    return shown
  })
}

/** A token can straddle colour runs, so a row that holds one is redacted whole and keeps its first run's look. */
export function redactTerminalSegmentRows(rows: TerminalLineSegment[][]): TerminalLineSegment[][] {
  const texts = rows.map((row) => row.map((segment) => segment.text).join(''))
  const redacted = redactWrappedTerminalRows(texts)
  return rows.map((row, index) =>
    redacted[index] === texts[index] || row.length === 0
      ? row
      : [{ ...row[0], text: redacted[index] }]
  )
}
