import { describe, expect, it, vi } from 'vitest'
import { readGamePrCap, type GamePrCapPorts } from './orchestrator-game-pr-cap-read'

const portsOf = (over: Partial<GamePrCapPorts> = {}): GamePrCapPorts => ({
  parentPaneKeyOf: async (paneKey) => (paneKey === 'member-pane' ? 'lead-pane' : null),
  isRemoteMember: () => false,
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

  it('says why it cannot read the cap of a member dispatched from another host', async () => {
    expect(
      await readGamePrCap(
        { paneKey: 'remote-pane', terminalHandle: 'term_remote' },
        portsOf({ isRemoteMember: ({ terminalHandle }) => terminalHandle === 'term_remote' })
      )
    ).toEqual({ member: true, unknown: 'its lead runs on another host' })
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
