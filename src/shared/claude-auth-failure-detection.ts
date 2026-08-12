/* eslint-disable no-control-regex -- Why: auth-failure detection must strip ANSI and control bytes before matching provider output. */

export type ClaudeAuthFailureDetectionState = {
  tail: string
  lastDetectedAt: number
}

const DETECTION_TAIL_LIMIT = 2000
const REDETECTION_COOLDOWN_MS = 60_000

const ANSI_SEQUENCE_RE =
  /\x1b(?:\][\s\S]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[PX^_][\s\S]*?\x1b\\|[@-_])/g
const CONTROL_CHARACTER_RE = /[\x00-\x08\x0b-\x1f\x7f]/g

const AUTH_FAILURE_PATTERNS = [
  /\blogin\s+expired\b/i,
  /\bsession\s+expired\b[\s\S]{0,60}?\/login\b/i,
  /\b(?:oauth\s+)?token\s+(?:has\s+)?expired\b[\s\S]{0,60}?\/login\b/i,
  /\bplease\s+run\s+\/login\b/i,
  /\binvalid\s+api\s+key\b[\s\S]{0,60}?\/login\b/i,
  /\bauthentication_error\b/i
] as const

export function createClaudeAuthFailureDetectionState(): ClaudeAuthFailureDetectionState {
  return { tail: '', lastDetectedAt: 0 }
}

function normalizeTerminalOutput(value: string): string {
  return value
    .replace(ANSI_SEQUENCE_RE, ' ')
    .replace(CONTROL_CHARACTER_RE, ' ')
    .replace(/\s+/g, ' ')
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
  if (!AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false
  }
  if (now - state.lastDetectedAt < REDETECTION_COOLDOWN_MS) {
    return false
  }
  state.lastDetectedAt = now
  state.tail = ''
  return true
}
