import { describe, expect, it, vi } from 'vitest'
import { readGamePrCap, type GamePrCapPorts } from './orchestrator-game-pr-cap-read'

const portsOf = (over: Partial<GamePrCapPorts> = {}): GamePrCapPorts => ({
  parentPaneKeyOf: async (paneKey) => (paneKey === 'member-pane' ? 'lead-pane' : null),
  remoteLeadCapOf: () => null,
  leadHandleOf: (paneKey) => (paneKey === 'lead-pane' ? 'term_lead' : null),
  readLeadCap: async () => ({ open: 6, cap: 6 }),
  ...over
})

describe('readGamePrCap (ORCA-1301)', () => {
  it("reads a member's open PRs and cap from its lead's view, whatever its agent", async () => {
    const readLeadCap = vi.fn(async () => ({ open: 6, cap: 6 }))
    expect(await readGamePrCap({ paneKey: 'member-pane' }, portsOf({ readLeadCap }))).toEqual({
      member: true,
      open: 6,
      cap: 6
    })
    expect(readLeadCap).toHaveBeenCalledWith('term_lead', 'lead-pane')
  })

  it('reads the lead and a plain session as not members, without reading any cap', async () => {
    const readLeadCap = vi.fn(async () => ({ open: 9, cap: 1 }))
    expect(await readGamePrCap({ paneKey: 'lead-pane' }, portsOf({ readLeadCap }))).toEqual({
      member: false
    })
    expect(await readGamePrCap({}, portsOf({ readLeadCap }))).toEqual({ member: false })
    expect(readLeadCap).not.toHaveBeenCalled()
  })

  it("reads a member dispatched from another host from the count its lead's home sent", async () => {
    const remoteLeadCapOf = ({ terminalHandle }: { terminalHandle?: string }) =>
      terminalHandle === 'term_remote' ? { open: 6, cap: 6 } : null
    expect(
      await readGamePrCap(
        { paneKey: 'remote-pane', terminalHandle: 'term_remote' },
        portsOf({ remoteLeadCapOf })
      )
    ).toEqual({ member: true, open: 6, cap: 6 })
  })

  it('names both causes when the remote lead sent no fresh count', async () => {
    expect(
      await readGamePrCap(
        { paneKey: 'remote-pane', terminalHandle: 'term_remote' },
        portsOf({ remoteLeadCapOf: () => ({}) })
      )
    ).toEqual({
      member: true,
      unknown: expect.stringContaining('an older Orca there, or its lead is not reading the team')
    })
  })

  it("says the lead's review list is unread when its view has no open-PR count", async () => {
    expect(
      await readGamePrCap(
        { paneKey: 'member-pane' },
        portsOf({ readLeadCap: async () => ({ cap: 6 }) })
      )
    ).toEqual({ member: true, cap: 6, unknown: "the lead's review list is off or unread" })
  })
})
