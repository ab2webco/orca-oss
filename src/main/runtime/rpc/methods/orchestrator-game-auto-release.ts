import {
  gameAutoReleaseCandidatesOf,
  remoteDispatchIdOf,
  type GameAutoReleaseCandidate,
  type GameMemberReport
} from '../../../../shared/orchestrator-game-auto-release'
import { GAME_EVENT_TEXT_MAX } from '../../../../shared/orchestrator-game-events'
import { ticketOfMember } from '../../../../shared/orchestrator-game-fleet-verbs'
import type { GameAgent, OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import { WORKER_RELEASABLE_STATES } from '../../orchestration/worker-terminal-ownership'
import type { WorkerReleaseReceipt } from './orchestration-worker-release-completion'
import { releaseWorker } from './orchestration-worker-release'
import { isFederatedMemberGoneOnHost } from './orchestration-federated-worker-gone'

type LeadCaller = { worktreeId?: string; terminalHandle?: string }
type Attempt = 'releasing' | 'released' | 'kept'

// Why once per dispatch: a member release keeps (a human typed in it) stays listed, with its line, until the lead acts.
const attemptsByRuntime = new WeakMap<OrcaRuntimeService, Map<string, Attempt>>()
// Why throttled: each check costs the host a federationShow, and a state read comes every few seconds.
const GONE_CHECK_INTERVAL_MS = 5 * 60_000
const goneChecksByRuntime = new WeakMap<OrcaRuntimeService, Map<string, number>>()
/**
 * Releases, in the background, each member whose work landed after its worker_done, and returns
 * the lead's state without them, so its row and slot go at once (ORCA-864).
 */
export function withGameAutoRelease(
  runtime: OrcaRuntimeService,
  state: OrchestratorGameState,
  caller: LeadCaller
): OrchestratorGameState {
  if (state.role !== 'lead') {
    return state
  }
  let db: OrchestrationDb
  try {
    db = runtime.getOrchestrationDb()
  } catch {
    return state
  }
  const attempts = attemptsByRuntime.get(runtime) ?? new Map<string, Attempt>()
  attemptsByRuntime.set(runtime, attempts)
  const candidates = gameAutoReleaseCandidatesOf(state.agents, reportOf(db))
  for (const candidate of candidates) {
    if (!attempts.has(candidate.dispatchId)) {
      attempts.set(candidate.dispatchId, 'releasing')
      void release(runtime, attempts, candidate, caller)
    }
  }
  settleGoneRemoteMembers(runtime, db, state.agents, candidates, caller)
  const leaving = new Set(
    candidates
      .filter((candidate) => attempts.get(candidate.dispatchId) !== 'kept')
      .map((candidate) => candidate.agent.paneKey)
  )
  return leaving.size === 0
    ? state
    : { ...state, agents: state.agents.filter((agent) => !leaving.has(agent.paneKey)) }
}

// Why the home DB: worker_done settles the member's own worker row there, local or remote alike.
function reportOf(db: OrchestrationDb): (agent: GameAgent) => GameMemberReport | null {
  let local: ReturnType<OrchestrationDb['listWorkerTerminalResources']> | null = null
  const reported = (dispatchId: string): GameMemberReport | null => {
    const at = utcMsOf(db.getDispatchContextById(dispatchId)?.completed_at ?? null)
    return Number.isFinite(at) ? { dispatchId, at } : null
  }
  return (agent) => {
    const remote = remoteDispatchIdOf(agent)
    if (remote) {
      const worker = db.getWorkerDispatch(remote)
      return worker &&
        worker.stage !== 'released' &&
        WORKER_RELEASABLE_STATES.includes(worker.state)
        ? reported(remote)
        : null
    }
    if (!agent.terminalHandle) {
      return null
    }
    local ??= db.listWorkerTerminalResources()
    const row = local.findLast((one) => one.agentTerminalHandle === agent.terminalHandle)
    return row &&
      row.terminalState !== 'released' &&
      WORKER_RELEASABLE_STATES.includes(row.workerState)
      ? reported(row.dispatchId)
      : null
  }
}

// Why: SQLite's datetime('now') has no T and no zone; it is UTC.
const utcMsOf = (at: string | null): number =>
  at ? Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`) : Number.NaN

/**
 * A remote member that sent worker_done and whose host terminal is gone leaves once its host proves
 * nothing of it remains; only the home row is settled, so nothing on the host is touched (ORCA-943).
 */
function settleGoneRemoteMembers(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  agents: readonly GameAgent[],
  landed: readonly GameAutoReleaseCandidate[],
  caller: LeadCaller
): void {
  const checks = goneChecksByRuntime.get(runtime) ?? new Map<string, number>()
  goneChecksByRuntime.set(runtime, checks)
  const now = Date.now()
  const report = reportOf(db)
  for (const agent of agents) {
    const dispatchId = remoteDispatchIdOf(agent)
    const remote = agent.remote
    const environmentId = remote?.environmentId
    if (
      !dispatchId ||
      !remote?.gone ||
      !environmentId ||
      landed.some((one) => one.dispatchId === dispatchId) ||
      now - (checks.get(dispatchId) ?? -Infinity) < GONE_CHECK_INTERVAL_MS ||
      !report(agent)
    ) {
      continue
    }
    checks.set(dispatchId, now)
    void (async () => {
      const gone = await isFederatedMemberGoneOnHost(runtime, environmentId, dispatchId).catch(
        () => false
      )
      if (!gone) {
        return
      }
      db.markFederatedWorkerReleased(dispatchId)
      runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
      await runtime
        .getGameBoard()
        .postEvent({
          ...caller,
          kind: 'stopped',
          ticket: ticketOfMember(agent) ?? undefined,
          text: `Released automatically: nothing of it is left on ${remote.host} after worker_done.`,
          key: `auto-release:${dispatchId}`
        })
        .catch(() => undefined)
    })()
  }
}

async function release(
  runtime: OrcaRuntimeService,
  attempts: Map<string, Attempt>,
  candidate: GameAutoReleaseCandidate,
  caller: LeadCaller
): Promise<void> {
  let text: string
  try {
    const receipt = await releaseWorker(runtime, candidate.dispatchId, undefined)
    const released = receipt.state === 'released' || receipt.state === 'already_released'
    attempts.set(candidate.dispatchId, released ? 'released' : 'kept')
    text = released ? releasedLineOf(candidate, receipt) : keptLineOf(candidate, receipt)
  } catch (error) {
    attempts.set(candidate.dispatchId, 'kept')
    text = `Not released automatically (${candidate.why}): ${error instanceof Error ? error.message : String(error)}`
  }
  await runtime
    .getGameBoard()
    .postEvent({
      ...caller,
      kind: 'stopped',
      ticket: candidate.ticket ?? undefined,
      text: text.slice(0, GAME_EVENT_TEXT_MAX),
      key: `auto-release:${candidate.dispatchId}`
    })
    .catch(() => undefined)
}

function releasedLineOf(
  candidate: GameAutoReleaseCandidate,
  receipt: WorkerReleaseReceipt
): string {
  const host = candidate.agent.remote?.host
  const closed =
    receipt.processAction === 'none'
      ? 'nothing was left to close'
      : host
        ? `its terminal on ${host} closed`
        : 'its terminal closed'
  return `Released automatically: ${candidate.why} after worker_done; ${closed}.`
}

const keptLineOf = (candidate: GameAutoReleaseCandidate, receipt: WorkerReleaseReceipt): string =>
  `Not released automatically (${candidate.why}): kept as ${receipt.reason ?? receipt.state}${receipt.recovery ? `. ${receipt.recovery}` : '.'}`
