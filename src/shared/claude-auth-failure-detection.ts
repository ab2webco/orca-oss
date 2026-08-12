/* eslint-disable no-control-regex -- Why: auth-failure detection must strip ANSI and control bytes before matching provider output. */

export type ClaudeAuthFailureDetectionState = {
  tail: string
  lastDetectedAt: number
  ptyId: string | null
  /** When this pane started watching the current PTY. A banner cannot testify
   *  about a credential reissued after that instant. */
  boundAt: number
}

const DETECTION_TAIL_LIMIT = 2000
const REDETECTION_COOLDOWN_MS = 60_000

const ANSI_SEQUENCE_RE =
  /\x1b(?:\][\s\S]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[PX^_][\s\S]*?\x1b\\|[@-_])/g
const CONTROL_CHARACTER_RE = /[\x00-\x08\x0b-\x1f\x7f]/g

const AUTH_REJECTION_BANNER_RE = /\blogin\s+expired\b.{0,80}\bplease\s+run\s+\/login\b/i
const QUOTED_OR_LOGGED_LINE_RE =
  /^\s*(?:["'`]|(?:const|let|var)\s|\[[a-z]+\]|(?:debug|info|warn|error)\b)/i

export function createClaudeAuthFailureDetectionState(): ClaudeAuthFailureDetectionState {
  return { tail: '', lastDetectedAt: 0, ptyId: null, boundAt: 0 }
}

export function bindClaudeAuthFailureDetectionToPty(
  state: ClaudeAuthFailureDetectionState,
  ptyId: string | null,
  now: number
): void {
  if (state.ptyId === ptyId) {
    return
  }
  state.ptyId = ptyId
  state.boundAt = now
  state.tail = ''
  state.lastDetectedAt = 0
}

function normalizeTerminalOutput(value: string): string {
  return value
    .replace(ANSI_SEQUENCE_RE, ' ')
    .replace(CONTROL_CHARACTER_RE, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
}

function rememberTail(state: ClaudeAuthFailureDetectionState, value: string): string {
  const next = `${state.tail}${value}`
  state.tail = next.length > DETECTION_TAIL_LIMIT ? next.slice(-DETECTION_TAIL_LIMIT) : next
  return state.tail
}

export function detectClaudeAuthFailureOutput(
  chunk: string,
  state: ClaudeAuthFailureDetectionState,
  now: number
): boolean {
  if (chunk.length === 0) {
    return false
  }
  const normalized = normalizeTerminalOutput(rememberTail(state, chunk))
  const detected = normalized
    .split('\n')
    .some((line) => !QUOTED_OR_LOGGED_LINE_RE.test(line) && AUTH_REJECTION_BANNER_RE.test(line))
  if (!detected) {
    return false
  }
  if (now - state.lastDetectedAt < REDETECTION_COOLDOWN_MS) {
    return false
  }
  state.lastDetectedAt = now
  state.tail = ''
  return true
}
