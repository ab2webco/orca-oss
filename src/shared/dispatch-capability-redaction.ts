import type { TerminalLineSegment } from './terminal-line-segments'

// Why no length floor, unlike the transcript's: status text is cut at 160 chars, so a line can hold only a token's head.
// A Claude OAuth token (sk-ant-oat, refresh sk-ant-ort) or an API key (sk-ant-api) shows up when a
// member runs env or printenv.
const BEARER_SECRET = /dcap_[A-Za-z0-9_-]+|(?<![A-Za-z0-9_-])sk-ant-(?:o[ar]t|api)[A-Za-z0-9_-]*/g

const holdsSecret = (text: string | undefined): text is string =>
  text !== undefined && (text.includes('dcap_') || text.includes('sk-ant-'))

/** A worker's own command lines carry its capability, and its env its OAuth token: bearer secrets no row may show. */
export const redactDispatchCapability = (text: string): string =>
  holdsSecret(text) ? text.replace(BEARER_SECRET, '[redacted]') : text

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
  if (!fields.some(holdsSecret)) {
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
            holdsSecret(one.description)
              ? { ...one, description: redactDispatchCapability(one.description) }
              : one
          )
        }
      : {})
  }
}

const TOKEN_CHAR = /[A-Za-z0-9_-]/
// A capability is 32 random bytes in base64url (orchestration db), so a match crosses rows for 43 chars at most.
// An OAuth token or API key runs about 95 chars past its prefix; the bound leaves room for a longer
// one. No left boundary here: the row join drops the `=` before a token that starts the next row.
const WRAPPED_SECRET = /dcap_[A-Za-z0-9_-]{1,43}|sk-ant-(?:o[ar]t|api)[A-Za-z0-9_-]{1,128}/g
// Each kind's longest match; a run past it is longer than any real token, a fake one that wraps the same way.
const MATCH_BOUND = { dcap: 48, skAnt: 138 }
const FILLED_BY_ONE_RUN = /^[^A-Za-z0-9_-]*[A-Za-z0-9_-]+$/

/** Whether the first row is a full row of one wrapped run, whose head may sit on a row above it. */
export const rowsOpenInsideWrappedRun = (rows: readonly string[]): boolean =>
  rows.length > 1 && FILLED_BY_ONE_RUN.test(rows[0]) && rows[0].length === rows[1].length

/**
 * A token can run past its row by the terminal's wrap or an app's wrap under a hanging indent, at any row
 * length. So every row's last word is read as running on into the next row's first word, past the indent
 * or border between them. The cost, taken for a secret: a word after a cut token at a row's end goes too.
 */
export function redactWrappedTerminalRows(rows: readonly string[]): string[] {
  let stream = ''
  const origin: { row: number; column: number }[] = []
  rows.forEach((row, rowIndex) => {
    let first = 0
    let last = row.length
    while (first < last && !TOKEN_CHAR.test(row[first])) {
      first++
    }
    while (last > first && !TOKEN_CHAR.test(row[last - 1])) {
      last--
    }
    stream += row.slice(first, last)
    for (let column = first; column < last; column++) {
      origin[origin.length] = { row: rowIndex, column }
    }
  })
  // Per row: each hidden column, and whether a token starts there.
  const hidden = rows.map(() => new Map<number, boolean>())
  for (const match of stream.matchAll(WRAPPED_SECRET)) {
    let end = match.index + match[0].length
    const startRow = rows[origin[match.index].row]
    const bound = match[0].startsWith('dcap_') ? MATCH_BOUND.dcap : MATCH_BOUND.skAnt
    // Why the row lengths: rows a hard wrap breaks a run over are as long as the row it started in,
    // where a word on the row after a real token ends is not.
    const runsOn = (at: number): boolean => {
      const from = rows[origin[at - 1].row]
      const to = rows[origin[at].row]
      return (
        (at - match.index > bound && from.length === startRow.length) ||
        (FILLED_BY_ONE_RUN.test(to) && to.length === from.length)
      )
    }
    // Inside one row a longer run is no word of the next row, so it goes whole, as on a single line.
    while (
      end < stream.length &&
      TOKEN_CHAR.test(stream[end]) &&
      (origin[end].row === origin[end - 1].row || runsOn(end))
    ) {
      end++
    }
    for (let at = match.index; at < end; at++) {
      hidden[origin[at].row].set(origin[at].column, at === match.index)
    }
  }
  return rows.map((row, index) => {
    if (hidden[index].size === 0) {
      return row
    }
    let shown = ''
    for (let column = 0; column < row.length; column++) {
      const start = hidden[index].get(column)
      shown += start === undefined ? row[column] : start ? '[redacted]' : ''
    }
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
