import { describe, expect, it } from 'vitest'
import { parseAgentStatusPayload } from './agent-status-types'
import {
  redactAgentStatusText,
  redactDispatchCapability,
  redactTerminalSegmentRows,
  redactWrappedTerminalRows
} from './dispatch-capability-redaction'
import type { TerminalLineSegment } from './terminal-line-segments'

const CAPABILITY = `dcap_${'A'.repeat(43)}`

describe('redactDispatchCapability', () => {
  it.each([
    [
      `orca orchestration send --dispatch-capability ${CAPABILITY} --type heartbeat`,
      'orca orchestration send --dispatch-capability [redacted] --type heartbeat'
    ],
    [
      `orca orchestration ask --dispatch-capability=${CAPABILITY} --question "Merge?"`,
      'orca orchestration ask --dispatch-capability=[redacted] --question "Merge?"'
    ],
    [`echo ${CAPABILITY} ${CAPABILITY}`, 'echo [redacted] [redacted]'],
    // Why: status text is cut at 160 chars, so a line can hold only a token's head.
    [
      'orca orchestration send --dispatch-capability dcap_Ab',
      'orca orchestration send --dispatch-capability [redacted]'
    ],
    // Why: base64url tokens can end in '-', which a trailing \b would leave behind.
    [`send ${CAPABILITY}- now`, 'send [redacted] now']
  ])('hides the token in: %s', (line, shown) => {
    expect(redactDispatchCapability(line)).toBe(shown)
  })

  it('leaves other text alone', () => {
    const line = 'npx vitest run dcapital_markets.test.ts'
    expect(redactDispatchCapability(line)).toBe(line)
  })
})

// The three ways a capability reaches text: a spaced flag, an `=` flag and a bare token.
const SEEDED = [
  `--dispatch-capability ${CAPABILITY}`,
  `--dispatch-capability=${CAPABILITY}`,
  `token ${CAPABILITY}`
].join(' ; ')
const SHOWN =
  '--dispatch-capability [redacted] ; --dispatch-capability=[redacted] ; token [redacted]'

describe('agent status payloads', () => {
  it('hides the token in every text a hook payload carries', () => {
    const parsed = parseAgentStatusPayload(
      JSON.stringify({
        state: 'working',
        prompt: `Run ${SEEDED}`,
        toolName: 'Bash',
        toolInput: SEEDED,
        interactivePrompt: JSON.stringify({ question: SEEDED }),
        lastAssistantMessage: `Sent ${SEEDED}`,
        subagents: [{ id: 'sub-1', state: 'working', startedAt: 1, description: SEEDED }]
      })
    )
    expect(JSON.stringify(parsed)).not.toContain('dcap_')
    expect(parsed?.prompt).toBe(`Run ${SHOWN}`)
    expect(parsed?.toolInput).toBe(SHOWN)
    expect(parsed?.lastAssistantMessage).toBe(`Sent ${SHOWN}`)
    expect(parsed?.subagents?.[0].description).toBe(SHOWN)
  })

  it('returns a clean payload as the same object', () => {
    const payload = { state: 'working' as const, prompt: 'Fix the dcapital test' }
    expect(redactAgentStatusText(payload)).toBe(payload)
  })
})

describe('redactWrappedTerminalRows', () => {
  // A 20-column screen: every full row is a wrap, the short last row ends the line.
  const wrap = (text: string): string[] => text.match(/.{1,20}/g) ?? []

  it.each([
    ['mid-token', `send ${CAPABILITY} now`],
    ['inside the prefix', `send --cap dc${CAPABILITY.slice(2)} now`]
  ])('drops a token wrapped %s', (_name, line) => {
    const rows = redactWrappedTerminalRows(wrap(line))
    expect(rows.join('')).not.toMatch(/dcap_|AAAA/)
    expect(rows.join('')).toContain('[redacted] now')
  })

  it('leaves the next row alone when a short row ends in a token', () => {
    const rows = ['x'.repeat(30), `id ${CAPABILITY.slice(0, 12)}`, 'ls -la']
    expect(redactWrappedTerminalRows(rows)).toEqual(['x'.repeat(30), 'id [redacted]', 'ls -la'])
  })
})

describe('redactTerminalSegmentRows', () => {
  const run = (text: string, color: TerminalLineSegment['color'] = 'default') => ({
    text,
    color,
    bold: false,
    dim: false
  })

  it('redacts a token split across colour runs', () => {
    const row = [
      run('orca send --dispatch-capability ', 'green'),
      run(CAPABILITY.slice(0, 9)),
      run(CAPABILITY.slice(9))
    ]
    expect(redactTerminalSegmentRows([row])).toEqual([
      [run('orca send --dispatch-capability [redacted]', 'green')]
    ])
  })

  it('keeps a clean row and its colours as they are', () => {
    const row = [run('ok', 'green'), run(' done')]
    expect(redactTerminalSegmentRows([row])[0]).toBe(row)
  })
})
