// Why: full Orca dispatch preambles are multi-KB (CLI instructions before
// `=== TASK ===`). A naive first-N-char fold of the agent-status prompt keeps
// only lifecycle boilerplate and drops the task body the UI needs as a
// fallback label before orchestration metadata arrives. Compact the status
// prompt so preamble detection, the live task id, and the task body all fit
// inside AGENT_STATUS_MAX_FIELD_LENGTH.

export const ORCA_DISPATCH_STATUS_PREAMBLE_PREFIX =
  'You are working inside Orca, a multi-agent IDE.'
export const ORCA_DISPATCH_STATUS_TASK_MARKER = '=== TASK ==='
const ORCA_DISPATCH_STATUS_TASK_ID_MARKER = 'Your task ID is:'
// Why: real preambles put === TASK === near the end (~4KB+). Scan past the
// normal single-line budget so the task body is still reachable for compacting.
const ORCA_DISPATCH_STATUS_SOURCE_SCAN_LIMIT = 24_576

// Why both: the Lab brand renamed the preamble (ORCA-392); an older host still sends the first.
const ORCA_DISPATCH_PREAMBLE_PREFIXES = [
  ORCA_DISPATCH_STATUS_PREAMBLE_PREFIX,
  'You are working inside Orca Lab, a multi-agent IDE.'
]
// Why: a brief pasted into an agent arrives wrapped in this tag, so the preamble no longer leads.
const PASTED_CONTENT_OPEN = /^<pasted_content\b[^>]{0,120}>/

const skipWhitespace = (value: string, from: number, end: number): number => {
  let index = from
  while (index < end && isEcmaTrimWhitespace(value.charCodeAt(index))) {
    index++
  }
  return index
}

/** Where a dispatch preamble starts, past whitespace and a pasted-content tag; -1 when none. */
function dispatchPreambleStartOf(value: string): number {
  // Why: status payloads cross a trust boundary. Keep dispatch detection
  // bounded too, or leading whitespace can bypass the normalizer's scan cap.
  const scanEnd = Math.min(value.length, ORCA_DISPATCH_STATUS_SOURCE_SCAN_LIMIT)
  let start = skipWhitespace(value, 0, scanEnd)
  const tag = PASTED_CONTENT_OPEN.exec(value.slice(start, Math.min(scanEnd, start + 160)))
  if (tag) {
    start = skipWhitespace(value, start + tag[0].length, scanEnd)
  }
  return ORCA_DISPATCH_PREAMBLE_PREFIXES.some(
    (prefix) => start + prefix.length <= scanEnd && value.startsWith(prefix, start)
  )
    ? start
    : -1
}

export function isOrcaDispatchStatusPrompt(value: string): boolean {
  return dispatchPreambleStartOf(value) !== -1
}

/** The first line of a dispatch's task body, or null when the prompt carries none. */
export function orcaDispatchTaskBodyOf(value: string): string | null {
  const start = dispatchPreambleStartOf(value)
  if (start === -1) {
    return null
  }
  const scan = value.slice(start, Math.min(value.length, ORCA_DISPATCH_STATUS_SOURCE_SCAN_LIMIT))
  const marker = findOrcaDispatchTaskMarkerIndex(scan)
  if (marker === -1) {
    return null
  }
  for (const line of scan.slice(marker + ORCA_DISPATCH_STATUS_TASK_MARKER.length).split(/\r?\n/)) {
    const text = line.trim().replace(/\s+/g, ' ')
    if (text) {
      return text
    }
  }
  return null
}

/**
 * Collapse a multi-KB dispatch preamble into a single-line status preview that
 * still carries enough structure for UI helpers:
 *   `<preamble prefix> Your task ID is: <id> === TASK === <task body>`
 */
export function compactDispatchPromptForStatus(
  value: string,
  maxLength: number,
  normalizeSingleLine: (value: string, maxLength: number) => string
): string {
  const scanEnd = Math.min(value.length, ORCA_DISPATCH_STATUS_SOURCE_SCAN_LIMIT)
  // Bound leading trim to the scan window so a multi-MB paste of pure
  // whitespace cannot walk the entire string before we give up.
  const preambleStart = dispatchPreambleStartOf(value)
  const start = preambleStart === -1 ? skipWhitespace(value, 0, scanEnd) : preambleStart
  const scan = value.slice(start, scanEnd)

  let taskId = ''
  const idMarkerIndex = scan.indexOf(ORCA_DISPATCH_STATUS_TASK_ID_MARKER)
  if (idMarkerIndex !== -1) {
    const afterId = scan.slice(idMarkerIndex + ORCA_DISPATCH_STATUS_TASK_ID_MARKER.length)
    let idStart = 0
    while (idStart < afterId.length && isEcmaTrimWhitespace(afterId.charCodeAt(idStart))) {
      idStart++
    }
    const idRest = afterId.slice(idStart)
    const idEnd = idRest.search(/\s/)
    taskId = (idEnd === -1 ? idRest : idRest.slice(0, idEnd)).trim()
  }

  let taskBody = ''
  const taskMarkerIndex = findOrcaDispatchTaskMarkerIndex(scan)
  if (taskMarkerIndex !== -1) {
    const body = scan.slice(taskMarkerIndex + ORCA_DISPATCH_STATUS_TASK_MARKER.length)
    for (const line of body.split(/\r?\n/)) {
      const preview = line.trim().replace(/\s+/g, ' ')
      if (preview) {
        taskBody = preview
        break
      }
    }
  }

  // Why: keep the dispatch prefix (isOrcaDispatchPrompt) + task id (label match)
  // + task body (fallback preview) so UI helpers still work on the 200-char field.
  let compact = ORCA_DISPATCH_STATUS_PREAMBLE_PREFIX
  if (taskId) {
    compact += ` ${ORCA_DISPATCH_STATUS_TASK_ID_MARKER} ${taskId}`
  }
  if (taskBody) {
    compact += ` ${ORCA_DISPATCH_STATUS_TASK_MARKER} ${taskBody}`
  }
  return normalizeSingleLine(compact, maxLength)
}

/**
 * Locate the Orca task separator in a dispatch prompt scan window.
 * Why: base-drift commit subjects are repository-controlled and may mention
 * `=== TASK ===`. Raw multi-line preambles must use the standalone line Orca
 * emits; already-normalized single-line status previews intentionally keep the
 * marker inline so re-normalization and UI helpers stay consistent.
 */
export function findOrcaDispatchTaskMarkerIndex(value: string): number {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const markerIndex = value.indexOf(ORCA_DISPATCH_STATUS_TASK_MARKER, searchFrom)
    if (markerIndex === -1) {
      break
    }
    const markerEnd = markerIndex + ORCA_DISPATCH_STATUS_TASK_MARKER.length
    const startsLine = markerIndex === 0 || isLineBreak(value.charCodeAt(markerIndex - 1))
    const endsLine = markerEnd === value.length || isLineBreak(value.charCodeAt(markerEnd))
    if (startsLine && endsLine) {
      return markerIndex
    }
    searchFrom = markerEnd
  }

  // Already-normalized dispatch previews are single-line and intentionally
  // carry the marker inline; normalization must stay idempotent across hops.
  return value.includes('\n') || value.includes('\r')
    ? -1
    : value.indexOf(ORCA_DISPATCH_STATUS_TASK_MARKER)
}

function isLineBreak(code: number): boolean {
  return code === 10 || code === 13
}

function isEcmaTrimWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  )
}
