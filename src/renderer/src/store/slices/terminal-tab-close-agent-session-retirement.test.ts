import { describe, expect, it, vi } from 'vitest'
import {
  resolveRetirableSleepingAgentPaneKeys,
  sessionLogShowsFinishedTurn,
  type SleepingAgentSessionIdentity
} from './terminal-tab-close-agent-session-retirement'

function identity(paneKey: string): SleepingAgentSessionIdentity {
  return {
    paneKey,
    agent: 'claude',
    providerSession: { key: 'session_id', id: paneKey }
  }
}

describe('sessionLogShowsFinishedTurn', () => {
  it('is true only for an unambiguous, non-working reading', () => {
    expect(
      sessionLogShowsFinishedTurn({
        read: true,
        state: 'awaiting-input',
        lastTurnAtMs: 1,
        queuedInput: { supported: true, pending: 0 },
        unparsedRecords: 0
      })
    ).toBe(true)
    expect(
      sessionLogShowsFinishedTurn({
        read: true,
        state: 'queued-input',
        lastTurnAtMs: 1,
        queuedInput: { supported: true, pending: 1 },
        unparsedRecords: 0
      })
    ).toBe(true)
  })

  it('is false for a mid-turn reading', () => {
    expect(
      sessionLogShowsFinishedTurn({
        read: true,
        state: 'working',
        lastTurnAtMs: 1,
        queuedInput: { supported: true, pending: 0 },
        unparsedRecords: 0
      })
    ).toBe(false)
  })

  it('is false for every unreadable/unknown/malformed reading', () => {
    expect(sessionLogShowsFinishedTurn({ read: false, reason: 'session-log-unreadable' })).toBe(
      false
    )
    expect(sessionLogShowsFinishedTurn({ read: false, reason: 'agent-session-unknown' })).toBe(
      false
    )
    expect(sessionLogShowsFinishedTurn(undefined)).toBe(false)
    expect(sessionLogShowsFinishedTurn(null)).toBe(false)
  })
})

describe('resolveRetirableSleepingAgentPaneKeys', () => {
  it('retires only the pane keys the log confirms are done', async () => {
    const readForIdentity = vi.fn(async ({ providerSession }) => {
      return providerSession.id === 'finished'
        ? {
            read: true as const,
            state: 'awaiting-input' as const,
            lastTurnAtMs: 1,
            queuedInput: { supported: true as const, pending: 0 },
            unparsedRecords: 0
          }
        : {
            read: true as const,
            state: 'working' as const,
            lastTurnAtMs: 1,
            queuedInput: { supported: true as const, pending: 0 },
            unparsedRecords: 0
          }
    })

    const retirable = await resolveRetirableSleepingAgentPaneKeys(
      [identity('finished'), identity('mid-turn')],
      readForIdentity
    )

    expect(retirable).toEqual(new Set(['finished']))
  })

  it('preserves everything when no reader is wired', async () => {
    const retirable = await resolveRetirableSleepingAgentPaneKeys(
      [identity('unknown')],
      undefined
    )
    expect(retirable.size).toBe(0)
  })

  it('preserves the pane whose read rejects, without failing the others', async () => {
    const readForIdentity = vi.fn(async ({ providerSession }) => {
      if (providerSession.id === 'boom') {
        throw new Error('ipc unavailable')
      }
      return {
        read: true as const,
        state: 'no-activity' as const,
        lastTurnAtMs: null,
        queuedInput: { supported: true as const, pending: 0 },
        unparsedRecords: 0
      }
    })

    const retirable = await resolveRetirableSleepingAgentPaneKeys(
      [identity('boom'), identity('fine')],
      readForIdentity
    )

    expect(retirable).toEqual(new Set(['fine']))
  })
})
