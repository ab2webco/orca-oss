import type { GamePrCap } from '../../shared/orchestrator-game-pr-cap'

export type GamePrCapCaller = { paneKey?: string; terminalHandle?: string; role?: string }

export type GamePrCapPorts = {
  parentPaneKeyOf: (paneKey: string) => Promise<string | null>
  /** Null when no live remote Dispatch runs the caller; else the fresh count its home sent, if any. */
  remoteLeadCapOf: (caller: GamePrCapCaller) => { open?: number; cap?: number } | null
  leadHandleOf: (leadPaneKey: string) => string | null
  readLeadCap: (leadHandle: string, leadPaneKey: string) => Promise<{ open?: number; cap?: number }>
}

// Why both causes: the wrapper prints this, and only the lead's host can say which one it is.
const REMOTE_UNKNOWN =
  'its lead runs on another host, which sent no open-PR count in the last 5 minutes: an older Orca there, or its lead is not reading the team'

/** Reads a member's open-PR cap from its lead's view; the lead and plain sessions are not members. */
export async function readGamePrCap(
  caller: GamePrCapCaller,
  ports: GamePrCapPorts
): Promise<GamePrCap> {
  const parent = caller.paneKey ? await ports.parentPaneKeyOf(caller.paneKey) : null
  if (!parent) {
    const remote = ports.remoteLeadCapOf(caller)
    if (remote?.open !== undefined && remote.cap !== undefined) {
      return { member: true, open: remote.open, cap: remote.cap }
    }
    return remote || caller.role === 'member'
      ? { member: true, unknown: REMOTE_UNKNOWN }
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
