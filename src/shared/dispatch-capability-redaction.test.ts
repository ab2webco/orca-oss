import { describe, expect, it } from 'vitest'
import { redactDispatchCapability } from './dispatch-capability-redaction'

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
