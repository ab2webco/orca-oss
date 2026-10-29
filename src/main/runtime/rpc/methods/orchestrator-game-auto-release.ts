import {
  gameAutoReleaseCandidatesOf,
  remoteDispatchIdOf,
  type GameAutoReleaseCandidate
} from '../../../../shared/orchestrator-game-auto-release'
import { GAME_EVENT_TEXT_MAX } from '../../../../shared/orchestrator-game-events'
import type { GameAgent, OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import { WORKER_RELEASABLE_STATES } from '../../orchestration/worker-terminal-ownership'
import type { WorkerReleaseReceipt } from './orchestration-worker-release-completion'
import { releaseWorker } from './orchestration-worker-release'

type LeadCaller = { worktreeId?: string; terminalHandle?: string }
type Attempt = 'releasing' | 'released' | 'kept'

// Why once per dispatch: a member release keeps (a human typed in it) stays listed, with its line, until the lead acts.
const attemptsByRuntime = new WeakMap<OrcaRuntimeService, Map<string, Attempt>>()
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
  const candidates = gameAutoReleaseCandidatesOf(state.agents, reportedDispatchOf(db))
  for (const candidate of candidates) {
    if (!attempts.has(candidate.dispatchId)) {
      attempts.set(candidate.dispatchId, 'releasing')
      void release(runtime, attempts, candidate, caller)
    }
  }
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
function reportedDispatchOf(db: OrchestrationDb): (agent: GameAgent) => string | null {
  let local: ReturnType<OrchestrationDb['listWorkerTerminalResources']> | null = null
  return (agent) => {
    const remote = remoteDispatchIdOf(agent)
    if (remote) {
      const worker = db.getWorkerDispatch(remote)
      return worker &&
        worker.stage !== 'released' &&
        WORKER_RELEASABLE_STATES.includes(worker.state)
        ? remote
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
      ? row.dispatchId
      : null
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
