import { describe, expect, it } from 'vitest'
import {
  formatOrchestrationCheckText,
  prepareOrchestrationCheckOutput
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
