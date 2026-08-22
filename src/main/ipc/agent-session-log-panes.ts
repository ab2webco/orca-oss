// Batch pane → session-log reading for the dashboard grid. One round trip for N
// cells, because a per-cell channel would poll N times per tick (ORCA-234).

import { ipcMain } from 'electron'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { AgentSessionLogPaneReading } from '../../shared/agent-session-log-state'
import { agentHookServer, isValidPaneKey } from '../agent-hooks/server'
import { readAgentSessionLogState } from '../native-chat/session-log-agent-state'
import { selectAgentSessionIdentityForPane } from '../runtime/terminal-agent-session-log-state'

/** A dashboard screen holds well under this; the cap keeps a malformed request
 *  from turning one IPC call into an unbounded fan of transcript scans. */
export const MAX_AGENT_SESSION_LOG_PANES = 64
/** Tail scans are IO-bound and short; a few at a time keeps their parse work
 *  interleaved rather than arriving on the main thread as one block. */
const READ_CONCURRENCY = 4

export function normalizeAgentSessionLogPaneKeys(request: unknown): string[] {
  if (!Array.isArray(request)) {
    return []
  }
  const keys = new Set<string>()
  for (const value of request) {
    if (typeof value !== 'string' || !isValidPaneKey(value)) {
      continue
    }
    keys.add(value)
    if (keys.size >= MAX_AGENT_SESSION_LOG_PANES) {
      break
    }
  }
  return [...keys]
}

export async function readAgentSessionLogPanes(
  paneKeys: readonly string[],
  statuses: readonly AgentStatusIpcPayload[]
): Promise<AgentSessionLogPaneReading[]> {
  const readings: AgentSessionLogPaneReading[] = new Array(paneKeys.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let index = next++; index < paneKeys.length; index = next++) {
      readings[index] = await readOnePane(paneKeys[index], statuses)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, paneKeys.length) }, () => worker())
  )
  return readings
}

async function readOnePane(
  paneKey: string,
  statuses: readonly AgentStatusIpcPayload[]
): Promise<AgentSessionLogPaneReading> {
  const identity = selectAgentSessionIdentityForPane(paneKey, statuses)
  if (!identity) {
    // Why a reason and not an omission: a pane whose agent no hook row has named
    // yet must degrade visibly in its cell, not silently (ORCA-191).
    return {
      paneKey,
      agent: null,
      sessionId: null,
      session: { read: false, reason: 'agent-session-unknown' }
    }
  }
  const session = await readAgentSessionLogState({
    agent: identity.agent,
    sessionId: identity.providerSession.id,
    transcriptPath: identity.providerSession.transcriptPath,
    includeActivity: true
  })
  return { paneKey, agent: identity.agent, sessionId: identity.providerSession.id, session }
}

export function registerAgentSessionLogPaneHandlers(): void {
  ipcMain.removeHandler('agentSessionLog:readPanes')
  ipcMain.handle(
    'agentSessionLog:readPanes',
    async (_event, request: unknown): Promise<AgentSessionLogPaneReading[]> => {
      const paneKeys = normalizeAgentSessionLogPaneKeys(request)
      return paneKeys.length === 0
        ? []
        : readAgentSessionLogPanes(paneKeys, agentHookServer.getStatusSnapshot())
    }
  )
}
