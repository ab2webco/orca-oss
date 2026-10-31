import type { CommandHandler } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import { gameResetInText } from '../../shared/orchestrator-game-account-pick'
import type { GameAgent, OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { launchGameMember } from './orchestrator-game-launch'
import type { GameLaunchResult } from './orchestrator-game-launch-result'
import type { GameRemotePlacement } from './orchestrator-game-launch-options'
import type { GameMoveResult } from './orchestrator-game-move'
import { dispatchOf, STOPPABLE, type GameStopWorker } from './orchestrator-game-stop'

type Client = Parameters<CommandHandler>[0]['client']

const REMOTE_PANE = 'remote:'

const whereOf = (host: string, email: string | undefined): string =>
  [host, email].filter(Boolean).join(' · ')

/** The member's dispatch still running, if any: a settled one has nothing left to stop. */
function liveDispatchOf(member: GameAgent, workers: GameStopWorker[]): string | null {
  if (member.paneKey.startsWith(REMOTE_PANE)) {
    const id = member.paneKey.slice(REMOTE_PANE.length)
    const worker = workers.find((one) => one.dispatchId === id)
    return worker && STOPPABLE.has(worker.workerState) ? id : null
  }
  const target = {
    row: { terminalHandle: member.terminalHandle ?? null },
    worktreeId: member.worktree?.id ?? null
  }
  return dispatchOf(target, workers)?.dispatchId ?? null
}

/**
 * A move to a paired host is a new member there, not an in-place switch (ORCA-798). It starts
 * first, so a host that refuses leaves the old member as it was; the old dispatch then stops
 * without a release, which keeps its worktree and the work in it.
 */
export async function moveMemberToHost(args: {
  client: Client
  state: OrchestratorGameState
  member: GameAgent
  ticket: string
  placement: GameRemotePlacement
  /** What the lead typed; unset keeps the project's account policy. */
  account: string | undefined
  flags: Map<string, string | boolean>
  cwd: string
  now?: number
  launch?: typeof launchGameMember
}): Promise<GameMoveResult> {
  const { client, member, ticket, placement } = args
  const from = whereOf(member.remote?.host ?? 'this host', member.account?.email)
  const { result } = await client.call<{ workers: GameStopWorker[] }>(
    'orchestration.workerList',
    {}
  )
  const previous = liveDispatchOf(member, result.workers)
  const started = (await (args.launch ?? launchGameMember)({
    client,
    state: args.state,
    ticket,
    repo: placement.repo,
    flags: args.flags,
    cwd: args.cwd,
    overrides: {
      ...(member.agentType ? { agent: member.agentType } : {}),
      ...(args.account ? { account: args.account } : {})
    },
    remote: placement
  })) as GameLaunchResult & { refusal?: { code: string; data?: { resetsAt?: number | null } } }
  if (started.state !== 'ready' && started.state !== 'queued') {
    if (started.refusal?.code === 'accounts_limited') {
      const resetsAt = started.refusal.data?.resetsAt ?? null
      const at = resetsAt === null ? '' : ` (${new Date(resetsAt).toISOString()})`
      return {
        ticket,
        moved: false,
        from,
        wait: `every account on ${placement.on} is at or near its limit; the first is usable again ${gameResetInText(resetsAt, args.now ?? Date.now())}${at}.`
      }
    }
    throw new RuntimeClientError(
      'move_failed',
      `${ticket} could not start on ${placement.on}: ${started.lastError ?? started.state}; it stays on ${from}.`
    )
  }
  if (previous) {
    await client.call('orchestration.workerStop', { dispatch: previous })
  }
  return {
    ticket,
    moved: true,
    via: 'host',
    from,
    to: whereOf(placement.on, started.account),
    ...(started.dispatchId ? { dispatchId: started.dispatchId } : {}),
    state: started.state,
    ...(member.worktree
      ? { kept: `${member.remote?.host ?? 'this host'} ⎇${member.worktree.branch}` }
      : {})
  }
}
