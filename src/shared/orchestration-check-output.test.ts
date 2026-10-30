import { describe, expect, it } from 'vitest'
import {
  formatOrchestrationCheckText,
  prepareOrchestrationCheckOutput,
  type OrchestrationCheckOutput
} from './orchestration-check-output'

describe('formatOrchestrationCheckText', () => {
  // Why: a new lead sees one line for the previous lead's settled backlog, never the backlog (ORCA-824).
  it('names what it retired and which of those still wait for verification', () => {
    const text = formatOrchestrationCheckText(
      {
        count: 0,
        messages: [],
        retired: {
          count: 44,
          unverified: [
            { ticket: 'ORCA-805', pr: '#701 open' },
            { ticket: 'ORCA-681', pr: null }
          ]
        }
      },
      'term_lead'
    )

    expect(text).toBe(
      '44 inherited messages retired to history (check --all). Still unverified: ORCA-805 (PR #701 open), ORCA-681 (no PR).\nNo messages.'
    )
  })

  it('prints nothing extra when nothing was retired', () => {
    expect(formatOrchestrationCheckText({ count: 0, messages: [] }, 'term_lead')).toBe(
      'No messages.'
    )
  })

  it('prints the body of a current message so a plain check is enough to act', () => {
    const text = formatOrchestrationCheckText(
      {
        count: 1,
        messages: [
          {
            id: 'msg_rebase',
            run_id: 'run_adopted',
            delivery_contract: 'current_delivery',
            from_handle: 'term_lead',
            to_handle: 'term_member',
            subject: 'Rebase now',
            type: 'status',
            body: 'Rebase onto main and push before the release cut.'
          }
        ]
      },
      'term_member'
    )

    expect(text).toContain('msg_rebase [status] from=term_lead "Rebase now"')
    expect(text).toContain('Rebase onto main and push before the release cut.')
  })
})

describe('prepareOrchestrationCheckOutput', () => {
  it('keeps mixed read-only mail safe and current Run replies executable', () => {
    const prepared = prepareOrchestrationCheckOutput(
      {
        count: 2,
        messages: [
          {
            id: 'msg_current',
            run_id: 'run_adopted',
            delivery_contract: 'current_delivery',
            from_handle: 'term_worker',
            to_handle: 'run:run_adopted',
            subject: 'Question'
          },
          {
            id: 'msg_legacy',
            run_id: 'run_legacy_local',
            delivery_contract: 'audit_only',
            from_handle: 'term_legacy',
            to_handle: 'term_coord',
            subject: 'Old reply'
          }
        ],
        formatted: '[Reply: unsafe stale formatter output]'
      },
      'term_current_coord',
      true
    )

    expect(prepared.formatted).toContain(
      '[Reply: orca orchestration reply --id msg_current --body "..."]'
    )
    expect(prepared.formatted).not.toContain('--from run:run_adopted')
    expect(prepared.formatted).toContain(
      '[Inspection only: reply and acknowledgment are unavailable.]'
    )
    expect(prepared.formatted).not.toContain('unsafe stale formatter output')
  })
})

// Why (ORCA-858): Claude Code's Monitor shows each stdout line cut at ~500 characters, each event at ~3000.
const MONITOR_LINE_CUT = 500
const MONITOR_EVENT_CUT = 3000

describe('long bodies under a cutting watch', () => {
  const longBody = `Ver "informe" ${'ñandú 🐧 '.repeat(330)}fin`
  const result: OrchestrationCheckOutput = {
    count: 2,
    deliveryId: 'delivery_1',
    messages: [
      {
        id: 'msg_short',
        from_handle: 'term_member',
        to_handle: 'term_lead',
        subject: 'Status',
        type: 'status',
        body: 'Short.',
        payload: null
      },
      {
        id: 'relay_long',
        from_handle: 'dispatch:ctx_remote',
        to_handle: 'run:run_home',
        subject: 'Done',
        type: 'worker_done',
        body: longBody,
        payload: null
      }
    ]
  }

  it('names the exact read of each long message before anything a cut could drop', () => {
    const json = JSON.stringify(
      prepareOrchestrationCheckOutput<OrchestrationCheckOutput>(result, 'term_lead', false),
      null,
      2
    )
    const command = 'orca orchestration inbox --terminal run:run_home --id relay_long'

    expect(JSON.parse(json).readInFull).toEqual([command])
    expect(json.split('\n').slice(0, 3).join('\n')).toContain(JSON.stringify(command))
  })

  it('names a message whose payload alone is long', () => {
    const prepared = prepareOrchestrationCheckOutput<OrchestrationCheckOutput>(
      {
        count: 1,
        messages: [{ ...result.messages[0], payload: JSON.stringify({ summary: 'x'.repeat(500) }) }]
      },
      'term_lead',
      false
    )

    expect(prepared.readInFull).toEqual([
      'orca orchestration inbox --terminal term_lead --id msg_short'
    ])
  })

  it('adds nothing when every body fits one line', () => {
    const prepared = prepareOrchestrationCheckOutput<OrchestrationCheckOutput>(
      { count: 1, messages: [result.messages[0]] },
      'term_lead',
      false
    )

    expect(prepared).not.toHaveProperty('readInFull')
  })

  it('quotes a recipient the shell would split', () => {
    const prepared = prepareOrchestrationCheckOutput<OrchestrationCheckOutput>(
      { count: 1, messages: [{ ...result.messages[1], to_handle: "it's here" }] },
      'term_lead',
      false
    )

    expect(prepared.readInFull).toEqual([
      `orca orchestration inbox --terminal 'it'\\''s here' --id relay_long`
    ])
  })

  it('leads the text with the read and wraps lines so none is cut', () => {
    const text = formatOrchestrationCheckText(result, 'term_lead')
    const lines = text.split('\n')

    expect(text.slice(0, MONITOR_EVENT_CUT)).toContain(
      'Read in full: orca orchestration inbox --terminal run:run_home --id relay_long'
    )
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(MONITOR_LINE_CUT)
    const bodyStart = lines.lastIndexOf('[body]') + 1
    expect(
      lines
        .slice(bodyStart)
        .map((line) => line.slice(2))
        .join('')
    ).toBe(longBody)
  })
})
