import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { gameBoardCaller, recordGameMember } from './orchestrator-game-board-call'
import { ticketsOf } from './orchestrator-game-fleet'
import { readCallerGameState } from './orchestrator-game-launch'
import { refuseWhileStopped } from './orchestrator-game-hold'
import {
  formatStoppedTerminal,
  settleOpenTerminal,
  stopDiscardedTerminals
} from './orchestrator-game-open-member-terminal'
import {
  runtimeCapabilitiesOf,
  setupAdmissionOf,
  type GameSetupQueue
} from './orchestrator-game-setup-queue'
import {
  gameFleetReportOf,
  localGameFreeOf,
  type GameFleet
} from '../../shared/orchestrator-game-fleet-verbs'
import {
  asleepOnHostsOf,
  ticketOfRemoteMember,
  wakeOnHost
} from './orchestrator-game-resume-remote-members'
import {
  formatResumedMembers,
  type GameResumedMember
} from './orchestrator-game-resumed-member-report'
import { gameHostLoadFor } from '../../shared/orchestrator-game-host-load'
import type {
  GameMemberResumeOutcome,
  GameMemberResumeTarget,
  GamePausedMember,
  GameUnlistedMember
} from '../../shared/orchestrator-game-member-sessions'

type Client = Parameters<CommandHandler>[0]['client']

type WorkerStarted = { dispatchId?: string; state: string; setupQueue?: GameSetupQueue }

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
          // Why only new-child: worker-start refuses creation options on an existing worktree.
          ...(member.worktreeId ? {} : { name: member.ticket.toLowerCase() }),
          ...(member.name ? { displayName: member.name } : {}),
          agent: member.agent ?? 'claude',
          ...accountPinOf(member),
          // Why only without a worktree: only a new worktree runs setup.
          ...(member.worktreeId ? {} : setupAdmissionOf(await runtimeCapabilitiesOf(client))),
          game: true
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
    ...(started.setupQueue ? { setupQueue: started.setupQueue } : {}),
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

const capReasonOf = (fleet: Pick<GameFleet, 'cap' | 'hosts'>, running: number): string => {
  const local = fleet.hosts && gameHostLoadFor(fleet.hosts, null)
  return local && running < fleet.cap
    ? `cap: this Orca is at its cap of ${local.cap}`
    : `cap: ${fleet.cap} members already run`
}

const unlistedReason = (one: GameUnlistedMember): string =>
  `its agent runs in ${one.branch ?? one.worktreeId}, but this lead does not list it`

const worktreeGoneReason = (one: GamePausedMember): string =>
  `its worktree ${one.branch ?? 'of record'} is gone; \`orca game resume-members ${one.ticket} --discard\` frees it`

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
      const stopped = await stopDiscardedTerminals(
        client,
        (state.pausedMembers ?? []).filter((one) => discarded.result.discarded.includes(one.ticket))
      )
      printResult({ ...discarded, result: { ...discarded.result, stopped } }, json, (result) =>
        result.setAside
          ? `Set the unreadable members file aside at ${result.setAside}; new members are saved from now on.`
          : [
              `Freed ${result.discarded.length}: ${result.discarded.join(', ') || 'none'}`,
              ...result.stopped.map(formatStoppedTerminal)
            ].join('\n')
      )
      return
    }
    if (state.pausedMembersError) {
      process.exitCode = 1
      printResult(
        { ...response, result: { error: state.pausedMembersError } },
        json,
        (result) =>
          `Could not resume members: ${result.error}. If a newer Orca wrote it, update Orca; this one leaves it as it is. If it is damaged, \`orca game resume-members --discard\` sets it aside, kept, and starts a new record.`
      )
      return
    }
    const listed = (state.pausedMembers ?? []).filter(
      (one) => named.length === 0 || named.includes(one.ticket)
    )
    // Why apart: retrying them failed at every lead start, before the worktree was even checked (ORCA-832).
    const gone = listed.filter((one) => one.worktreeGone)
    const paused = listed.filter((one) => !one.worktreeGone)
    const unlisted = (state.unlistedMembers ?? []).filter(
      (one) => named.length === 0 || named.includes(one.ticket)
    )
    // Why apart: they wake on the host that slept them, so they take none of this Orca's slots (ORCA-915).
    const asleepOnHosts = asleepOnHostsOf(state.agents, named)
    const fleet = gameFleetReportOf({ ...state, pausedMembers: [] })
    const liveMembers = fleet.running
    // Why local slots: a paused member reopens on this Orca, whatever room paired hosts have (ORCA-888).
    const room = localGameFreeOf(fleet)
    if (flags.get('dry-run') === true) {
      // Why apart: the real run presses Enter or skips these, and their agents already hold slots.
      const open = paused.filter((one) => one.terminal && one.cause !== undefined)
      const closed = paused.filter((one) => !open.includes(one))
      const free = Math.max(0, room - open.length)
      const ticketsWith = (cause: string): string[] =>
        open.filter((one) => one.cause === cause).map((one) => one.ticket)
      printResult(
        {
          ...response,
          result: {
            dryRun: true,
            submit: ticketsWith('unsubmitted'),
            openTerminal: ticketsWith('terminal-open'),
            resume: closed.slice(0, free).map((one) => one.ticket),
            overCap: closed.slice(free).map((one) => one.ticket),
            ...(asleepOnHosts.length > 0 ? { wake: asleepOnHosts.map(ticketOfRemoteMember) } : {}),
            ...(unlisted.length > 0 ? { unlisted } : {}),
            ...(gone.length > 0 ? { unresumable: gone.map((one) => one.ticket) } : {})
          }
        },
        json,
        (plan) =>
          `${plan.submit.length ? `Would press Enter for: ${plan.submit.join(', ')} · ` : ''}${plan.openTerminal.length ? `Would skip, terminal still open: ${plan.openTerminal.join(', ')} · ` : ''}Would resume: ${plan.resume.join(', ') || 'none'}${plan.wake ? ` · would wake on their hosts: ${plan.wake.join(', ')}` : ''}${plan.overCap.length ? ` · over the cap: ${plan.overCap.join(', ')}` : ''}${plan.unlisted ? ` · running but not listed by this lead: ${plan.unlisted.map((one) => `${one.ticket} (${one.branch ?? one.worktreeId})`).join(', ')}` : ''}${gone.length > 0 ? ` · worktree gone, cannot resume: ${gone.map((one) => `${one.ticket} (${one.branch ?? '-'})`).join(', ')}; \`orca game resume-members <ticket> --discard\` frees it` : ''}`
      )
      return
    }
    refuseWhileStopped(state, 'resuming members')
    const from = await resolveCoordinatorTerminalHandle(flags, cwd, client)
    const members: GameResumedMember[] = [
      ...unlisted.map(
        (one): GameResumedMember => ({
          ticket: one.ticket,
          result: 'skipped',
          reason: unlistedReason(one)
        })
      ),
      ...gone.map(
        (one): GameResumedMember => ({
          ticket: one.ticket,
          result: 'unresumable',
          reason: worktreeGoneReason(one)
        })
      )
    ]
    let running = liveMembers
    let taken = 0
    // Why one at a time: N agents reopening at once can exhaust a small machine's memory.
    for (const member of paused) {
      try {
        // Why before the cap: its agent already runs, so it holds a slot whatever happens here.
        const settled = await settleOpenTerminal(client, member)
        if (settled) {
          members.push(settled)
          running += 1
          taken += 1
          if (settled.result === 'failed') {
            process.exitCode = 1
          }
          continue
        }
        if (taken >= room) {
          members.push({
            ticket: member.ticket,
            result: 'skipped',
            reason: capReasonOf(fleet, running)
          })
          continue
        }
        const refused = await bindRunOf(client, from, member, running)
        if (refused) {
          members.push({ ticket: member.ticket, result: 'skipped', reason: refused })
          continue
        }
        const resumed = await resumeOne(client, from, member.ticket)
        members.push(resumed)
        if (resumed.dispatchId || resumed.setupQueue) {
          running += 1
          taken += 1
        }
      } catch (error) {
        process.exitCode = 1
        members.push({ ticket: member.ticket, result: 'failed', reason: errorText(error) })
      }
    }
    for (const agent of asleepOnHosts) {
      members.push(await wakeOnHost(client, agent))
    }
    printResult({ ...response, result: { members } }, json, formatResumedMembers)
  }
}
