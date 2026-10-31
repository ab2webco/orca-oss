import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { switchClaudeTerminalAccount } from './account-switch'
import { openHostRuntimeClient } from './orchestrator-game-host-client'
import type { RuntimeAccountsSnapshot } from '../account-format'
import { readCallerGameState } from './orchestrator-game-launch'
import { refuseWhileStopped } from './orchestrator-game-hold'
import {
  GAME_ACCOUNTS_LIMITED,
  resolveGameMemberAccount,
  type GameMemberAccountChoice
} from './orchestrator-game-launch-account'
import { gameLaunchChoiceOf, remotePlacementOf } from './orchestrator-game-launch-options'
import { moveMemberToHost } from './orchestrator-game-move-host'
import { dispatchOf, type GameStopWorker } from './orchestrator-game-stop'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import {
  accountProviderOfAgent,
  GAME_ACCOUNT_PROVIDER_LABELS
} from '../../shared/orchestrator-game-member-agent'
import type { GameAgent, OrchestratorGameState } from '../../shared/orchestrator-game-state'

type Client = Parameters<CommandHandler>[0]['client']

export type GameMoveResult = {
  ticket: string
  moved: boolean
  dryRun?: boolean
  /** `switch` resumes a Claude session in its own terminal; `relaunch` restarts the member on its worktree; `host` starts it anew on another host. */
  via?: 'switch' | 'relaunch' | 'host'
  from: string | null
  to?: string
  dispatchId?: string
  state?: string
  /** Why it stays: every other account is at or near its limit, and when the first is back. */
  wait?: string
  /** The worktree the old host keeps after a move to another host. */
  kept?: string
}

const TICKET = /^[A-Z0-9][A-Z0-9_-]{0,39}$/

function ticketFlag(flags: Map<string, string | boolean>): string {
  const raw = flags.get('ticket')
  const ticket = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!TICKET.test(ticket)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name the member to move by its ticket, like CIN-12.'
    )
  }
  return ticket
}

function memberOf(state: OrchestratorGameState, ticket: string): GameAgent {
  const member = state.agents.find(
    (agent) => agent.isMember && !agent.isLeader && ticketOfMember(agent) === ticket
  )
  if (!member) {
    throw new RuntimeClientError(
      'invalid_argument',
      `No member holds ${ticket}; see \`orca game fleet\`.`
    )
  }
  return member
}

async function targetOf(
  client: Client,
  state: OrchestratorGameState,
  member: GameAgent,
  selector: string
): Promise<GameMemberAccountChoice | { wait: string }> {
  const agent = member.agentType ?? ''
  const provider = accountProviderOfAgent(agent)
  const lead = state.lead ?? DEFAULT_GAME_LEAD
  if (provider === null) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${agent || 'This agent'} has no Orca-managed accounts to move to; wait for its reset.`
    )
  }
  try {
    const target = await resolveGameMemberAccount(
      client,
      { agent, account: selector, allowedAccounts: gameLaunchChoiceOf({}, lead).allowedAccounts },
      { agents: state.agents, exclude: member.account?.id }
    )
    if (target.account === null) {
      throw new RuntimeClientError(
        'invalid_argument',
        `No other ${GAME_ACCOUNT_PROVIDER_LABELS[provider]} account to move to; add one in Settings → Accounts, or wait for the reset.`
      )
    }
    return target
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === GAME_ACCOUNTS_LIMITED) {
      return { wait: error.message }
    }
    throw error
  }
}

/** A remote member's account as its host names it: only the email crosses hosts (ORCA-798). */
async function onHostOf(host: Client, member: GameAgent): Promise<GameAgent> {
  if (!member.remote || !member.account) {
    return member
  }
  const { email } = member.account
  const { result } = await host.call<RuntimeAccountsSnapshot>('accounts.snapshot')
  const hostAccount = result[member.account.provider].accounts.find(
    (account) => account.email.toLowerCase() === email.toLowerCase()
  )
  return { ...member, account: hostAccount ? { ...member.account, id: hostAccount.id } : undefined }
}

async function relaunch(args: {
  client: Client
  state: OrchestratorGameState
  member: GameAgent
  target: GameMemberAccountChoice
  flags: Map<string, string | boolean>
  cwd: string
}): Promise<{ dispatchId: string; state: string }> {
  const { client, member } = args
  const { result } = await client.call<{ workers: GameStopWorker[] }>(
    'orchestration.workerList',
    {}
  )
  const worktreeId = member.worktree?.id ?? null
  const dispatch = dispatchOf(
    { row: { terminalHandle: member.terminalHandle ?? null }, worktreeId },
    result.workers
  )
  const where = dispatch?.resource?.worktreeId ?? worktreeId
  if (!dispatch?.taskId || !where) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${ticketOfMember(member)} has no live dispatch to relaunch; start it again with \`orca game launch <ticket> --account <email|id>\`.`
    )
  }
  const stopped = await client.call<{ state: string }>('orchestration.workerStop', {
    dispatch: dispatch.dispatchId
  })
  if (stopped.result.state !== 'stopped') {
    throw new RuntimeClientError(
      'stop_unsettled',
      `Stopping dispatch ${dispatch.dispatchId} ended ${stopped.result.state}; nothing was relaunched.`
    )
  }
  const choice = gameLaunchChoiceOf(
    { agent: member.agentType ?? undefined },
    args.state.lead ?? DEFAULT_GAME_LEAD
  )
  const started = await client.call<{ dispatchId: string; state: string }>(
    'orchestration.workerStart',
    {
      task: dispatch.taskId,
      retryOf: dispatch.dispatchId,
      worktree: `id:${where}`,
      agent: choice.agent,
      ...(choice.model ? { model: choice.model, effort: choice.effort } : {}),
      ...args.target.pin,
      run: dispatch.runId,
      from: await resolveCoordinatorTerminalHandle(args.flags, args.cwd, client),
      devMode: isDevCliInvocation()
    }
  )
  if (started.result.state !== 'ready') {
    process.exitCode = 1
  }
  return { dispatchId: started.result.dispatchId, state: started.result.state }
}

export const formatGameMove = (move: GameMoveResult): string => {
  if (move.wait) {
    return `${move.ticket} stays on ${move.from ?? 'its account'}: ${move.wait}`
  }
  const head = `${move.ticket} ${move.dryRun ? 'would move' : 'moved'} ${move.from ?? '?'} → ${move.to ?? '?'} (${move.via})`
  const line = move.dispatchId ? `${head}: member ${move.dispatchId} [${move.state}]` : head
  return move.kept ? `${line}; ${move.kept} kept` : line
}

export const ORCHESTRATOR_GAME_MOVE_HANDLERS: Record<string, CommandHandler> = {
  'game move': async (ctx) => {
    const { flags, client, cwd, json } = ctx
    const ticket = ticketFlag(flags)
    const raw = flags.get('account')
    const selector = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'auto'
    const response = await readCallerGameState(client)
    const state = response.result
    refuseWhileStopped(state, `moving ${ticket}`)
    const member = memberOf(state, ticket)
    const rawRepo = flags.get('repo')
    const placement = remotePlacementOf(
      flags,
      typeof rawRepo === 'string' && rawRepo.trim() !== '' ? rawRepo.trim() : null
    )
    if (placement) {
      const typed = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
      if (flags.get('dry-run') === true) {
        const plan: GameMoveResult = {
          ticket,
          moved: false,
          dryRun: true,
          via: 'host',
          from: member.account?.email ?? null,
          to: placement.on
        }
        printResult({ ...response, result: plan }, json, formatGameMove)
        return
      }
      const moved = await moveMemberToHost({
        client,
        state,
        member,
        ticket,
        placement,
        account: typed,
        flags,
        cwd
      })
      printResult({ ...response, result: moved }, json, formatGameMove)
      return
    }
    // Why only a Claude member with its host's handle stays: it resumes in place there (ORCA-916).
    if (member.remote && !(member.agentType === 'claude' && member.terminalHandle)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `${ticket} runs on ${member.remote.host}; move it with --on <host> --repo <selector of the repo there>, which starts it anew on that host.`
      )
    }
    const from = member.account?.email ?? null
    if (
      member.account &&
      (selector === member.account.id || selector.toLowerCase() === from?.toLowerCase())
    ) {
      throw new RuntimeClientError('invalid_argument', `${ticket} already runs on ${from}.`)
    }
    const host = member.remote ? await openHostRuntimeClient(member.remote.host) : client
    const target = await targetOf(host, state, await onHostOf(host, member), selector)
    if ('wait' in target) {
      printResult(
        { ...response, result: { ticket, moved: false, from, wait: target.wait } },
        json,
        formatGameMove
      )
      return
    }
    const via = member.agentType === 'claude' && member.terminalHandle ? 'switch' : 'relaunch'
    const plan: GameMoveResult = { ticket, moved: false, via, from, to: target.account?.email }
    if (flags.get('dry-run') === true) {
      printResult({ ...response, result: { ...plan, dryRun: true } }, json, formatGameMove)
      return
    }
    if (via === 'switch' && member.terminalHandle && target.account) {
      // Why reuse: Orca's in-place switch stops, repoints and resumes the same Claude session, with rollback.
      await switchClaudeTerminalAccount({
        ...ctx,
        client: host,
        flags: new Map([
          ['to', target.account.id],
          ['terminal', member.terminalHandle]
        ])
      })
      return
    }
    const started = await relaunch({ client, state, member, target, flags, cwd })
    printResult({ ...response, result: { ...plan, moved: true, ...started } }, json, formatGameMove)
  }
}
