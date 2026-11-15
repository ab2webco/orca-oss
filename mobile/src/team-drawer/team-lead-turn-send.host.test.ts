import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../../../src/main/runtime/rpc/dispatcher'
import { TERMINAL_METHODS } from '../../../src/main/runtime/rpc/methods/terminal'
import type { OrcaRuntimeService } from '../../../src/main/runtime/orca-runtime'
import type { RpcClient } from '../transport/rpc-client'
import { createTeamLeadTurnSender } from './team-lead-turn-send'

// Why: mobile CI installs root deps with --ignore-scripts, so node-pty has no Linux binary to load.
vi.mock('node-pty', () => ({ spawn: vi.fn() }))

// Why the real host: while the phone has the lead's session open the phone drives that terminal,
// and the host refuses agentPrompt from a mobile driver; a hand-made reply never sees that.
function phoneDrivenHost() {
  const sendTerminal = vi.fn(async (handle: string) => ({
    handle,
    accepted: true,
    bytesWritten: 16
  }))
  const runtime = {
    getRuntimeId: () => 'host-runtime',
    resolveLiveLeafForHandle: () => ({ ptyId: 'pty-lead' }),
    getDriver: () => ({ kind: 'mobile', clientId: 'phone-A' }),
    beginMobileInputFloor: () => ({ commit: () => {}, rollback: () => {} }),
    sendTerminal,
    sendTerminalAgentPrompt: vi.fn()
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
  const replies: unknown[] = []
  const client = {
    sendRequest: async (method: string, params: unknown) => {
      const reply = await dispatcher.dispatch({ id: 'req-1', authToken: 'tok', method, params })
      replies.push(reply)
      return reply
    }
  } as unknown as RpcClient
  return { client, sendTerminal, replies }
}

describe("the Team sheet lead turn against the host's terminal.send", () => {
  it('lands on a lead terminal the phone is driving', async () => {
    const { client, sendTerminal, replies } = phoneDrivenHost()
    const send = createTeamLeadTurnSender(() => 0)

    const outcome = await send(client, 'term_lead', 'lead:wave', '/orca-game:wave')

    expect(replies).toEqual([
      expect.objectContaining({
        ok: true,
        result: { send: expect.objectContaining({ accepted: true }) }
      })
    ])
    expect(outcome).toBe('sent')
    expect(sendTerminal).toHaveBeenCalledWith(
      'term_lead',
      { text: '/orca-game:wave', enter: true, interrupt: false },
      expect.anything()
    )
  })
})
