import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { gameBoardCaller, recordGameMember } from './orchestrator-game-board-call'
import { ticketsOf } from './orchestrator-game-fleet'
import { readCallerGameState } from './orchestrator-game-launch'
import { refuseWhileStopped } from './orchestrator-game-hold'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import type {
  GameMemberResumeOutcome,
  GameMemberResumeTarget,
  GamePausedMember
} from '../../shared/orchestrator-game-member-sessions'

type Client = Parameters<CommandHandler>[0]['client']

export type GameResumedMember = {
  ticket: string
  result: 'resumed' | 'relaunched' | 'finished' | 'skipped' | 'failed'
  dispatchId?: string
  reason?: string
  note?: string
}

type WorkerStarted = { dispatchId: string; state: string }

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Why by agent: worker-start pins a Claude or Codex account; other agents run on their own login.
const accountPinOf = (member: GameMemberResumeTarget): Record<string, string> => {
  if (!member.accountId) {
    return {}
  }
  if (member.agent === 'claude') {
    return { claudeAccountId: member.accountId }
  }
  return member.agent === 'codex' ? { codexAccountId: member.accountId } : {}
}

/** A fresh dispatch on the member's own task, so its worker_done and mail reach this lead. */
async function startOnTask(
  client: Client,
  from: string,
  outcome: Extract<GameMemberResumeOutcome, { outcome: 'resumed' | 'relaunch' }>
): Promise<WorkerStarted> {
  const { member } = outcome
  const worktree = member.worktreeId ? `id:${member.worktreeId}` : 'new-child'
  const params =
    outcome.outcome === 'resumed'
      ? { task: member.taskId, worktree, terminal: outcome.terminal }
      : {
          task: member.taskId,
          worktree,
          name: member.ticket.toLowerCase(),
          ...(member.name ? { displayName: member.name } : {}),
          agent: member.agent ?? 'claude',
          ...accountPinOf(member)
        }
  try {
    const started = await client.call<WorkerStarted>('orchestration.workerStart', {
      ...params,
      ...(member.retryOf ? { retryOf: member.retryOf } : {}),
      run: member.runId,
      from,
      devMode: isDevCliInvocation()
    })
    return started.result
  } catch (error) {
    // Why close: an agent no dispatch owns is no member, and would hide its ticket from the fleet.
    if (outcome.outcome === 'resumed') {
      await client.call('terminal.close', { terminal: outcome.terminal }).catch(() => undefined)
    }
    throw error
  }
}

async function resumeOne(client: Client, from: string, ticket: string): Promise<GameResumedMember> {
  const response = await client.call<GameMemberResumeOutcome>('game.memberResume', {
    ...gameBoardCaller(),
    ticket
  })
  const outcome = response.result
  if (outcome.outcome === 'finished') {
    return { ticket, result: 'finished' }
  }
  if (outcome.outcome === 'missing') {
    return { ticket, result: 'skipped', reason: outcome.reason }
  }
  const started = await startOnTask(client, from, outcome)
  await recordGameMember(client, {
    ticket,
    dispatchId: started.dispatchId,
    lastState: started.state
  })
  return {
    ticket,
    result: outcome.outcome === 'resumed' ? 'resumed' : 'relaunched',
    dispatchId: started.dispatchId,
    ...(outcome.outcome === 'relaunch' && outcome.note ? { note: outcome.note } : {})
  }
}

/** Binds the run that owns the paused members' tasks, unless the lead already runs live members elsewhere. */
async function bindRunOf(
  client: Client,
  from: string,
  member: GamePausedMember,
  liveMembers: number
): Promise<string | null> {
  const current = await client.call<{ run: { id: string } | null }>('orchestration.runCurrent', {
    from
  })
  const running = current.result.run?.id
  if (running === member.runId) {
    return null
  }
  if (running && liveMembers > 0) {
    return `its task is in run ${member.runId}, and this lead now runs ${running} with live members`
  }
  await client.call('orchestration.runUse', { id: member.runId, from })
  return null
}

const RESULT_TEXT: Record<GameResumedMember['result'], string> = {
  resumed: 'its conversation reopened',
  relaunched: 'a new agent started on its task',
  finished: 'already finished, forgotten',
  skipped: 'skipped',
  failed: 'failed'
}

export const formatResumedMembers = (result: { members: GameResumedMember[] }): string =>
  result.members.length === 0
    ? 'No paused members.'
    : result.members
        .map(
          (one) =>
            `${one.ticket}: ${RESULT_TEXT[one.result]}${one.dispatchId ? ` (member ${one.dispatchId})` : ''}${one.reason ? `: ${one.reason}` : ''}${one.note ? ` (${one.note})` : ''}`
        )
        .join('\n')

export const ORCHESTRATOR_GAME_RESUME_MEMBERS_HANDLERS: Record<string, CommandHandler> = {
  'game resume-members': async ({ flags, client, cwd, json }) => {
    const named = ticketsOf(flags)
    const response = await readCallerGameState(client)
    const state = response.result
    if (state.pausedMembers === undefined && state.pausedMembersError === undefined) {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'The connected Orca Lab does not keep game members yet. Update or restart Orca Lab.'
      )
    }
    if (flags.get('discard') === true) {
      const discarded = await client.call<{ discarded: string[]; setAside: string | null }>(
        'game.memberDiscard',
        { ...gameBoardCaller(), tickets: named.length > 0 ? named : 'all' }
      )
      printResult(discarded, json, (result) =>
        result.setAside
          ? `Set the unreadable members file aside at ${result.setAside}; new members are saved from now on.`
          : `Freed ${result.discarded.length}: ${result.discarded.join(', ') || 'none'}`
      )
      return
    }
    if (state.pausedMembersError) {
      process.exitCode = 1
      printResult(
        { ...response, result: { error: state.pausedMembersError } },
        json,
        (result) =>
          `Could not resume members: ${result.error}. \`orca game resume-members --discard\` sets the file aside, kept, and starts a new record.`
      )
      return
    }
    const paused = (state.pausedMembers ?? []).filter(
      (one) => named.length === 0 || named.includes(one.ticket)
    )
    const fleet = gameFleetReportOf({ ...state, pausedMembers: [] })
    const liveMembers = fleet.running
    if (flags.get('dry-run') === true) {
      const free = Math.max(0, fleet.cap - liveMembers)
      printResult(
        {
          ...response,
          result: {
            dryRun: true,
            resume: paused.slice(0, free).map((one) => one.ticket),
            overCap: paused.slice(free).map((one) => one.ticket)
          }
        },
        json,
        (plan) =>
          `Would resume: ${plan.resume.join(', ') || 'none'}${plan.overCap.length ? ` · over the cap: ${plan.overCap.join(', ')}` : ''}`
      )
      return
    }
    refuseWhileStopped(state, 'resuming members')
    const from = await resolveCoordinatorTerminalHandle(flags, cwd, client)
    const members: GameResumedMember[] = []
    let running = liveMembers
    // Why one at a time: N agents reopening at once can exhaust a small machine's memory.
    for (const member of paused) {
      if (running >= fleet.cap) {
        members.push({
          ticket: member.ticket,
          result: 'skipped',
          reason: `cap: ${fleet.cap} members already run`
        })
        continue
      }
      try {
        const refused = await bindRunOf(client, from, member, running)
        if (refused) {
          members.push({ ticket: member.ticket, result: 'skipped', reason: refused })
          continue
        }
        const resumed = await resumeOne(client, from, member.ticket)
        members.push(resumed)
        if (resumed.dispatchId) {
          running += 1
        }
      } catch (error) {
        process.exitCode = 1
        members.push({ ticket: member.ticket, result: 'failed', reason: errorText(error) })
      }
    }
    printResult({ ...response, result: { members } }, json, formatResumedMembers)
  }
}
