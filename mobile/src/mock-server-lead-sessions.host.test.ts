import type { WebSocket } from 'ws'
import { describe, expect, it } from 'vitest'
import { GameLeads } from '../../src/main/runtime/orchestrator-game-leads'
import { handleRequest } from '../scripts/mock-server-rpc-handlers'
import { LEAD_PANE_KEY } from '../scripts/mock-server-lead-sessions'

// Why against the real GameLeads: the mock types its lead replies by copy, and this keeps the copy honest.
const mockResult = (method: string, params?: Record<string, unknown>) =>
  new Promise<Record<string, unknown>>((resolve) => {
    handleRequest(
      { id: method, method, params },
      (one) => resolve(one.result as Record<string, unknown>),
      {} as WebSocket
    )
  })

const keysOf = (value: unknown) => Object.keys(value as object).sort()

describe("mock lead replies match the host's GameLeads", () => {
  it('lists a lead with the same fields game.leads sends', async () => {
    const host = new GameLeads({
      projectOf: async () => ({
        key: 'repo:a',
        isMember: false,
        memberTicket: null,
        lead: { handle: 'term-1', paneKey: null }
      }),
      isLive: () => true,
      paneOf: () => LEAD_PANE_KEY
    })
    await host.register({
      worktreeId: 'wt',
      terminalHandle: 'term-1',
      project: 'acme-web',
      label: 'Lead'
    })
    const hostLead = (await host.list()).leads[0]
    const mockLead = ((await mockResult('game.leads')).leads as unknown[])[0]

    expect(keysOf(mockLead)).toEqual(keysOf(hostLead))
  })
})
