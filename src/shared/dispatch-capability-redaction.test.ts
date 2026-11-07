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

  // The rows of the live check's Grid card at the 600 floor (ORCA-1125 reopen): an app wrap with a
  // hanging indent, between rows longer than the token's.
  it('drops a tail that wrapped under a hanging indent', () => {
    const token = `dcap_CHECKseedTOKEN000${'0'.repeat(26)}`
    const rows = [
      '⏺ Bash(orca orchestration send --type heartbeat --subject alive --phase starting)',
      `  ⎿  orca orchestration send --dispatch-capability ${token.slice(0, 6)}`,
      `     ${token.slice(6, 22)}`,
      `     ${token.slice(22, 38)}`,
      `     ${token.slice(38)} --task-id task_1`,
      '✻ Working… (12s · esc to interrupt · a row longer than every row of the token above)'
    ]
    expect(redactWrappedTerminalRows(rows)).toEqual([
      rows[0],
      '  ⎿  orca orchestration send --dispatch-capability [redacted]',
      '     ',
      '     ',
      '      --task-id task_1',
      rows[5]
    ])
  })

  // Why only Q, X, J and Z in the body: no other text here holds them, so one surviving character is a leak.
  const SECRET = `dcap_${'QXJZ'.repeat(11).slice(0, 43)}`
  const BODY_CHAR = /[QXJZ]/
  const appWrap = (line: string, width: number, indent: string): string[] => {
    const rows = [line.slice(0, width)]
    for (let at = width; at < line.length; at += width - indent.length) {
      rows.push(indent + line.slice(at, at + width - indent.length))
    }
    return rows
  }
  const lines = [
    ['at the row start', `${SECRET} --type heartbeat`],
    ['mid-row', `orca send --dispatch-capability ${SECRET} --type heartbeat`],
    ['after an equals sign', `orca send --dispatch-capability=${SECRET}`],
    ['twice in one pane', `a ${SECRET} b ${SECRET.slice(0, 30)}${SECRET.slice(30)} c`]
  ] as const
  const cases = lines.flatMap(([where, line]) =>
    [8, 12, 16, 20, 33, 40, 80].flatMap((width) =>
      ['', '  ', '     ', '  ⎿  ', '│ '].map((indent) => ({ where, line, width, indent }))
    )
  )

  it.each(cases)(
    'keeps no character of a token $where at width $width, indent "$indent"',
    ({ line, width, indent }) => {
      const rows = [
        'x'.repeat(width + 30),
        ...appWrap(line, width, indent),
        `${'y'.repeat(width + 10)} done`
      ]
      const shown = redactWrappedTerminalRows(rows)
      expect(shown.join('\n')).not.toMatch(BODY_CHAR)
      expect(shown.join('\n')).not.toContain('dcap')
      expect(shown[0]).toBe(rows[0])
      expect(shown.at(-1)).toBe(rows.at(-1))
    }
  )

  it('leaves a pane with no token as it is', () => {
    const rows = ['x'.repeat(30), 'id abc', 'ls -la']
    expect(redactWrappedTerminalRows(rows)).toEqual(rows)
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

// A member running `env` or `printenv` prints its Claude OAuth token (ORCA-1039). Real length: 13 + 95.
// Why only Q, X, J, Z, '-' and '_' in the body: no other text here holds Q, X, J or Z.
const OAUTH = `sk-ant-oat01-${'QXJZ'.repeat(22).slice(0, 86)}-ZJXQ_ZQX`
const REFRESH = `sk-ant-ort01-${'ZQXJ'.repeat(24).slice(0, 95)}`
const OAUTH_BODY = /[QXJZ]/

describe('Claude OAuth tokens', () => {
  it('uses a real-length token', () => {
    expect(OAUTH).toHaveLength(108)
  })

  it.each([
    [`CLAUDE_CODE_OAUTH_TOKEN=${OAUTH}`, 'CLAUDE_CODE_OAUTH_TOKEN=[redacted]'],
    [`export CLAUDE_CODE_OAUTH_TOKEN="${OAUTH}"`, 'export CLAUDE_CODE_OAUTH_TOKEN="[redacted]"'],
    [`"refreshToken":"${REFRESH}"`, '"refreshToken":"[redacted]"'],
    // Why: status text is cut at 160 chars, so a line can hold only the token's head.
    [
      'PATH=/usr/bin CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-QX',
      'PATH=/usr/bin CLAUDE_CODE_OAUTH_TOKEN=[redacted]'
    ]
  ])('hides it in: %s', (line, shown) => {
    expect(redactDispatchCapability(line)).toBe(shown)
  })

  it('hides it in every text a hook payload carries', () => {
    const printenv = `HOME=/home/m\nCLAUDE_CODE_OAUTH_TOKEN=${OAUTH}\nSHELL=/bin/zsh`
    const parsed = parseAgentStatusPayload(
      JSON.stringify({
        state: 'working',
        prompt: `why is ${OAUTH} rejected`,
        toolName: 'Bash',
        toolInput: printenv,
        lastAssistantMessage: printenv,
        subagents: [{ id: 'sub-1', state: 'working', startedAt: 1, description: printenv }]
      })
    )
    expect(JSON.stringify(parsed)).not.toContain('sk-ant-oat')
    expect(JSON.stringify(parsed)).not.toMatch(OAUTH_BODY)
  })

  const appWrap = (line: string, width: number, indent: string): string[] => {
    const rows = [line.slice(0, width)]
    for (let at = width; at < line.length; at += width - indent.length) {
      rows.push(indent + line.slice(at, at + width - indent.length))
    }
    return rows
  }
  const cases = [`CLAUDE_CODE_OAUTH_TOKEN=${OAUTH}`, `env | grep TOKEN ${OAUTH} done`].flatMap(
    (line) =>
      [8, 12, 20, 33, 40, 80, 120].flatMap((width) =>
        ['', '  ', '     ', '  ⎿  ', '│ '].map((indent) => ({ line, width, indent }))
      )
  )

  it.each(cases)(
    'keeps no character of a wrapped token at width $width, indent "$indent": $line',
    ({ line, width, indent }) => {
      const rows = [
        'x'.repeat(width + 30),
        ...appWrap(line, width, indent),
        `${'y'.repeat(width + 10)} done`
      ]
      const shown = redactWrappedTerminalRows(rows).join('\n')
      expect(shown).not.toMatch(OAUTH_BODY)
      expect(shown).not.toContain('sk-ant')
      expect(shown).toContain('[redacted]')
    }
  )

  it('redacts one split across colour runs', () => {
    const run = (text: string) => ({ text, color: 'default' as const, bold: false, dim: false })
    const row = [run('CLAUDE_CODE_OAUTH_TOKEN='), run(OAUTH.slice(0, 20)), run(OAUTH.slice(20))]
    expect(redactTerminalSegmentRows([row])).toEqual([[run('CLAUDE_CODE_OAUTH_TOKEN=[redacted]')]])
  })

  it('leaves other sk- text alone', () => {
    const line = 'risk-ant-oath and sk-proj-notours stay'
    expect(redactDispatchCapability(line)).toBe(line)
  })
})
