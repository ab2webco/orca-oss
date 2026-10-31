import { describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import { wakeSleepingTerminal, type TerminalWakeDeps } from './terminal-wake'

const RECORD = {
  paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
  worktreeId: 'repo::/wt',
  agent: 'claude',
  providerSession: { key: 'session_id', id: 'member-session' }
} as SleepingAgentSessionRecord

function deps(overrides: Partial<TerminalWakeDeps> = {}): TerminalWakeDeps {
  return {
    sleepingRecordOf: (handle) => (handle === 'term_asleep' ? RECORD : null),
    assertLiveHandle: (handle) => {
      if (handle !== 'term_live') {
        throw new Error('terminal_handle_stale')
      }
    },
    canWake: () => true,
    requestWake: vi.fn(),
    isAsleep: () => false,
    liveHandleOf: async () => 'term_woken',
    sleep: async () => {},
    ...overrides
  }
}

describe('wakeSleepingTerminal', () => {
  it('asks the host to wake the pane and answers with its running handle', async () => {
    const requestWake = vi.fn()
    let polls = 0
    const result = await wakeSleepingTerminal(
      deps({ requestWake, isAsleep: () => ++polls < 3 }),
      'term_asleep'
    )
    expect(requestWake).toHaveBeenCalledExactlyOnceWith(RECORD.paneKey)
    expect(result).toEqual({ handle: 'term_woken', status: 'woken', paneKey: RECORD.paneKey })
  })

  it('answers a running terminal as already awake without waking anything', async () => {
    const requestWake = vi.fn()
    await expect(wakeSleepingTerminal(deps({ requestWake }), 'term_live')).resolves.toEqual({
      handle: 'term_live',
      status: 'awake'
    })
    expect(requestWake).not.toHaveBeenCalled()
  })

  it('refuses a handle that names no terminal', async () => {
    await expect(wakeSleepingTerminal(deps(), 'term_gone')).rejects.toThrow('terminal_handle_stale')
  })

  it('refuses on a host with no window, which holds no wake authority', async () => {
    const requestWake = vi.fn()
    await expect(
      wakeSleepingTerminal(deps({ canWake: () => false, requestWake }), 'term_asleep')
    ).rejects.toThrow('terminal_wake_unavailable')
    expect(requestWake).not.toHaveBeenCalled()
  })

  it('reports a pane still starting when the wake outlasts the wait', async () => {
    let now = 0
    const result = await wakeSleepingTerminal(
      deps({
        isAsleep: () => true,
        now: () => now,
        sleep: async (ms) => {
          now += ms
        }
      }),
      'term_asleep',
      { timeoutMs: 1_000 }
    )
    expect(result).toEqual({ handle: null, status: 'waking', paneKey: RECORD.paneKey })
  })

  it('reports waking while the woken pane has no running terminal yet', async () => {
    const result = await wakeSleepingTerminal(
      deps({ liveHandleOf: async () => null }),
      'term_asleep'
    )
    expect(result).toEqual({ handle: null, status: 'waking', paneKey: RECORD.paneKey })
  })
})
