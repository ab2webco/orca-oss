import type { GamePrCap } from '../../shared/orchestrator-game-pr-cap'

export type GamePrCapCaller = { paneKey?: string; terminalHandle?: string; role?: string }

export type GamePrCapPorts = {
  /** The lead pane that launched this pane, or null for a lead or a plain session. */
  parentPaneKeyOf: (paneKey: string) => Promise<string | null>
  /** True when a home on another host dispatched this pane (a federated member). */
  isRemoteMember: (caller: GamePrCapCaller) => boolean
  leadHandleOf: (leadPaneKey: string) => string | null
  readLeadCap: (leadHandle: string, leadPaneKey: string) => Promise<{ open?: number; cap?: number }>
}

/** Reads a member's open-PR cap from its lead's view; the lead and plain sessions are not members. */
export async function readGamePrCap(
  caller: GamePrCapCaller,
  ports: GamePrCapPorts
): Promise<GamePrCap> {
  const parent = caller.paneKey ? await ports.parentPaneKeyOf(caller.paneKey) : null
  if (!parent) {
    return caller.role === 'member' || ports.isRemoteMember(caller)
      ? { member: true, unknown: 'its lead runs on another host' }
      : { member: false }
  }
  const leadHandle = ports.leadHandleOf(parent)
  if (!leadHandle) {
    return { member: true, unknown: 'its lead pane is not live' }
  }
  const { open, cap } = await ports.readLeadCap(leadHandle, parent)
  return {
    member: true,
    ...(open !== undefined ? { open } : {}),
    ...(cap !== undefined ? { cap } : {}),
    ...(open === undefined ? { unknown: "the lead's review list is off or unread" } : {})
  }
}
