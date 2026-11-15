import type { RuntimeCreateAgentSessionResult } from '../../src/shared/agent-session-host-authority'
import type { RpcRequest, RpcRespond, RpcResponse } from './mock-server-rpc-handlers'

// Why a UUID leaf: the phone opens the lead's tab only from a pane key parsePaneKey accepts.
export const LEAD_PANE_KEY = 'tab-1:f47ac10b-58cc-4372-a567-0e02b2c3d479'
const LEAD_HANDLE = 'term-1'

// Why copies: src/main/runtime/orchestrator-game-lead-types.ts pulls main-process code into mobile's
// tsc; src/mock-server-lead-sessions.host.test.ts holds them to the real GameLeads instead.
type GameLeadListing = {
  project: string
  label: string
  handle: string
  since: string
  paneKey?: string
  worktreeId?: string
}
type GameLeadRestoring = { project: string; paneKey: string }
type GameLeadRegistration = {
  registered: boolean
  live?: { handle: string }
  resumed?: { handle: string }
  resumeError?: string
}
type GameLeadsList = { leads: GameLeadListing[]; restoring?: GameLeadRestoring[] }
type GameLeadStored = { stored: { accountId: string | null } | null }

// MOCK_LEADS=none|restoring: no live lead, or one a restart has not brought back.
function leadsOf(worktreeId: string): GameLeadsList {
  const mode = process.env.MOCK_LEADS
  if (mode === 'none') {
    return { leads: [] }
  }
  if (mode === 'restoring') {
    return { leads: [], restoring: [{ project: 'acme-web', paneKey: LEAD_PANE_KEY }] }
  }
  const since = new Date(Date.now() - 40 * 60_000).toISOString()
  const lead = { project: 'acme-web', label: 'Lead', handle: LEAD_HANDLE, since }
  return { leads: [{ ...lead, paneKey: LEAD_PANE_KEY, worktreeId }] }
}

// MOCK_LEAD_STORED=<account id>|null: a kept lead conversation on that account, or on none.
function storedOf(): GameLeadStored {
  const kept = process.env.MOCK_LEAD_STORED
  return { stored: kept ? { accountId: kept === 'null' ? null : kept } : null }
}

// MOCK_REOPEN=ok reopens the kept lead; otherwise the host says why it could not.
const reopenOf = (): GameLeadRegistration =>
  process.env.MOCK_REOPEN === 'ok'
    ? { registered: false, resumed: { handle: LEAD_HANDLE } }
    : { registered: false, resumeError: 'the kept conversation is no longer on this computer' }

/** The + sheet's lead reads and starts: game.leads, leadStored, leadReopen and createAgentSession. */
export function handleMockLeadSessionRequest(
  request: RpcRequest,
  respond: RpcRespond,
  success: (id: string, result: unknown) => RpcResponse,
  activeWorktreeId: () => string | undefined
): boolean {
  switch (request.method) {
    case 'game.leads':
      respond(success(request.id, leadsOf(activeWorktreeId() ?? 'mock')))
      return true
    case 'game.leadStored':
      respond(success(request.id, storedOf()))
      return true
    case 'game.leadReopen':
      respond(success(request.id, reopenOf()))
      return true
    case 'terminal.createAgentSession': {
      const worktreeId = String(request.params?.worktree ?? '').replace(/^id:/, '')
      console.log('[mock] createAgentSession', JSON.stringify(request.params))
      const created: RuntimeCreateAgentSessionResult = {
        terminal: { handle: LEAD_HANDLE, tabId: 'tab-1', worktreeId, title: null },
        disposition: 'created'
      }
      respond(success(request.id, created))
      return true
    }
    default:
      return false
  }
}
