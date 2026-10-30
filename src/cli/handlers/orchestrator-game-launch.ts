import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { openPrWarningOf } from '../../shared/orchestrator-game-open-prs'
import {
  DEFAULT_GAME_LEAD,
  renderGameLaunchPrompt,
  withGameMemberCiNote
} from '../../shared/orchestrator-game-lead'
import {
  gameLaunchChoiceOf,
  parseGameLaunchFlags,
  remoteAccountParamsOf,
  remotePlacementOf,
  requiredTicket,
  taskPromptOf,
  type GameLaunchFlags,
  type GameRemotePlacement
} from './orchestrator-game-launch-options'
import {
  GAME_GLOBAL_LOGIN_LABEL,
  gameGlobalLoginNoteOf,
  globalLoginHolderOf,
  remoteGlobalLoginOf,
  resolveGameMemberAccount,
  type GameGlobalLoginLaunch
} from './orchestrator-game-launch-account'
import { callWithLaunchRetry } from './orchestrator-game-launch-retry'
import { checkGameMemberMcpServers } from './orchestrator-game-launch-mcp'
import { memberWorktreeParamsOf } from './orchestrator-game-launch-worktree'
import { forgetOnRefusal } from './orchestrator-game-launch-refusal'
import {
  postGameEvents,
  readCallerGameState,
  recordGameMember
} from './orchestrator-game-board-call'
import { refuseWhileStopped } from './orchestrator-game-hold'
import { gameLessonBriefFor, withGameLessons } from './orchestrator-game-lessons-call'
import type { GameLaunchedOnAccount } from '../../shared/orchestrator-game-account-usage'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { memberDisplayNameOf, memberNameOf } from '../../shared/orchestrator-game-member-names'
import { memberNameFor } from './orchestrator-game-member-name-reserve'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import {
  formatSetupQueue,
  runtimeCapabilitiesOf,
  setupAdmissionOf,
  type GameSetupQueue
} from './orchestrator-game-setup-queue'

export { readCallerGameState }

type Client = Parameters<CommandHandler>[0]['client']

export type GameLaunchResult = GameGlobalLoginLaunch & {
  ticket: string
  /** The scene character the member was named after; absent once the roster ran out. */
  name?: string
  agent: string
  /** The managed account's email and id; absent when Orca's own account selection applies. */
  account?: string
  accountId?: string
  runId: string
  taskId: string
  /** Absent while the member waits for the host's setup slot. */
  dispatchId?: string
  state: string
  setupQueue?: GameSetupQueue
  lastError?: string
}

type WorkerStartResult = Pick<
  GameLaunchResult,
  'runId' | 'taskId' | 'dispatchId' | 'state' | 'setupQueue' | 'lastError'
> & {
  effects?: { kind: string; id?: string }[]
  /** The host's own account for a member placed with --on; only its email crosses back (ORCA-798). */
  account?: { provider: string; email: string }
  /** A member placed with --on that runs on its host's global login, and why. */
  globalLogin?: 'no_account' | 'older_host'
}

const DISPLAY_NAME_MAX = 60

async function boundRunId(client: Client, from: string, objective: string): Promise<string> {
  const current = await client.call<{ run: { id: string } | null }>('orchestration.runCurrent', {
    from
  })
  if (current.result.run) {
    return current.result.run.id
  }
  const created = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
    objective,
    from
  })
  return created.result.run.id
}

function requireLaunchPreferences(capabilities: readonly string[]): void {
  if (!capabilities.includes(ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'The connected Orca Lab runtime cannot pick a member model. Update or restart Orca Lab.'
    )
  }
}

/** One member for one ticket, reporting to the calling lead; the caller owns the cap. */
export async function launchGameMember(args: {
  client: Client
  state: OrchestratorGameState
  ticket: string
  repo: string | null
  flags: Map<string, string | boolean>
  cwd: string
  /** Replaces the project's launchPrompt for this member. */
  prompt?: string | null
  /** --agent, --model, --effort and --account, over the lead config. */
  overrides?: GameLaunchFlags
  /** Members this same command launched, so `auto` spreads them before game.state shows them. */
  launched?: GameLaunchedOnAccount
  /** Names this same command already gave, for the same reason. */
  namesTaken?: readonly string[]
  /** Tickets this same command put on the global login, which takes one member at a time. */
  onGlobalLogin?: readonly string[]
  /** A paired host instead of this Orca; named from the same roster as a local member. */
  remote?: GameRemotePlacement | null
}): Promise<GameLaunchResult> {
  const { client, state, ticket, repo } = args
  const lead = state.lead ?? DEFAULT_GAME_LEAD
  const choice = gameLaunchChoiceOf(args.overrides ?? {}, lead)
  const where = args.remote
    ? { ...args.remote, worktree: 'new-top-level' }
    : await memberWorktreeParamsOf({ client, state, ticket, repo })
  const item = state.project?.todo?.items.find((one) => one.id.toUpperCase() === ticket)
  const inUse = state.agents.flatMap((agent) => memberNameOf(agent.displayName) ?? [])
  const name = await memberNameFor(client, state, ticket, [...inUse, ...(args.namesTaken ?? [])])
  const title = memberDisplayNameOf(
    name,
    item ? `${item.id} ${item.title}` : ticket,
    DISPLAY_NAME_MAX,
    item?.id ?? ticket
  )
  // Why: a host resolves the typed selector against its own roster and refuses a local pin.
  const memberAccount = args.remote
    ? { pin: {}, account: null }
    : await resolveGameMemberAccount(client, choice, {
        agents: state.agents,
        launched: args.launched,
        globalLoginHolder: globalLoginHolderOf(state.agents, choice.agent, args.onGlobalLogin ?? [])
      })
  await checkGameMemberMcpServers({
    client,
    state,
    ticket,
    agent: choice.agent,
    required: lead.mcpServers,
    skip: args.flags.get('skip-mcp-check') === true,
    repo,
    remote: args.remote ?? null,
    account: memberAccount.account,
    remoteAccount: choice.remoteAccount
  })
  const from = await resolveCoordinatorTerminalHandle(args.flags, args.cwd, client)
  const capabilities = await runtimeCapabilitiesOf(client)
  if (choice.model) {
    requireLaunchPreferences(capabilities)
  }
  const project = state.worktree?.displayName ?? 'this project'
  const runId = await boundRunId(
    client,
    from,
    `${lead.label ?? 'Lead'} of ${project}: one member per ticket`
  )
  const taskParams = {
    spec: withGameLessons(
      withGameMemberCiNote(
        renderGameLaunchPrompt(args.prompt ?? lead.launchPrompt, {
          id: item?.id ?? ticket,
          title: item?.title ?? '',
          url: item?.url ?? '',
          status: item?.status
        })
      ),
      await gameLessonBriefFor(client, item?.id ?? ticket)
    ),
    taskTitle: title,
    callerTerminalHandle: from
  }
  const task = await callWithLaunchRetry((requestId) =>
    client.call<{ task: { id: string } }>(
      'orchestration.taskCreate',
      taskParams,
      requestId ? { orchestrationRequestId: requestId } : undefined
    )
  )
  await recordGameMember(client, {
    ticket,
    name: title,
    runId,
    taskId: task.result.task.id,
    agent: choice.agent,
    accountId: memberAccount.account?.id,
    account: memberAccount.account?.email,
    lastState: 'launching'
  })
  const createsWorktree = where.worktree === 'new-child' || where.worktree === 'new-top-level'
  const workerParams = {
    task: task.result.task.id,
    ...where,
    // Why: workerStart refuses creation options for the existing worktree a relaunch reuses (ORCA-894).
    ...(createsWorktree ? { name: ticket.toLowerCase() } : {}),
    displayName: title,
    agent: choice.agent,
    ...(choice.model ? { model: choice.model, effort: choice.effort } : {}),
    ...memberAccount.pin,
    ...(args.remote ? remoteAccountParamsOf(choice) : {}),
    run: runId,
    from,
    devMode: isDevCliInvocation(),
    ...setupAdmissionOf(capabilities),
    game: true
  }
  const worker = await callWithLaunchRetry((requestId) =>
    client.call<WorkerStartResult>(
      'orchestration.workerStart',
      workerParams,
      requestId ? { orchestrationRequestId: requestId } : undefined
    )
  ).catch(forgetOnRefusal({ client, state, ticket, worktree: where.worktree }))
  await recordGameMember(client, {
    ticket,
    dispatchId: worker.result.dispatchId,
    worktreeId: worker.result.effects?.find((one) => one.kind === 'worktree')?.id,
    lastState: worker.result.state
  })
  const { account: hostAccount, globalLogin: hostGlobalLogin, ...started } = worker.result
  const launched: GameLaunchResult = {
    ticket,
    ...(name === null ? {} : { name }),
    agent: choice.agent,
    ...(memberAccount.account
      ? { account: memberAccount.account.email, accountId: memberAccount.account.id }
      : {}),
    ...(memberAccount.globalLogin ? { globalLogin: true as const } : {}),
    ...(hostAccount ? { account: hostAccount.email } : {}),
    ...(args.remote && hostGlobalLogin ? remoteGlobalLoginOf(args.remote.on, hostGlobalLogin) : {}),
    ...started
  }
  await postGameEvents(client, [
    {
      kind: 'claimed',
      ticket,
      text: `${launched.dispatchId ? `member ${launched.dispatchId} ` : ''}[${launched.state}] ${[launched.agent, launched.account].filter(Boolean).join(' · ')}`
    }
  ])
  return launched
}

export const formatGameLaunch = (launched: GameLaunchResult): string => {
  const who = [
    launched.agent,
    launched.account ?? (launched.globalLogin ? GAME_GLOBAL_LOGIN_LABEL : undefined)
  ]
    .filter(Boolean)
    .join(' · ')
  const what = launched.setupQueue
    ? formatSetupQueue(launched.setupQueue, who)
    : `member ${launched.dispatchId} [${launched.state}] ${who}`
  return `${launched.ticket}${launched.name ? ` (${launched.name})` : ''}: ${what}${launched.globalLogin ? `\n${gameGlobalLoginNoteOf(launched)}` : ''}${launched.lastError ? `\n${launched.lastError}` : ''}`
}

/** A queued member is on its way, not a failed launch. */
export const isLaunchUnderway = (launched: GameLaunchResult): boolean =>
  launched.state === 'ready' || launched.state === 'queued'

export const ORCHESTRATOR_GAME_LAUNCH_HANDLERS: Record<string, CommandHandler> = {
  'game launch': async ({ flags, client, cwd, json }) => {
    const ticket = requiredTicket(flags)
    const prompt = taskPromptOf(flags)
    const overrides = parseGameLaunchFlags(flags)
    const rawRepo = flags.get('repo')
    const repo = typeof rawRepo === 'string' && rawRepo.trim() !== '' ? rawRepo.trim() : null
    const remote = remotePlacementOf(flags, repo)
    const response = await readCallerGameState(client)
    refuseWhileStopped(response.result, ticket)
    if (response.result.pausedMembers?.some((one) => one.ticket === ticket)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `${ticket} is paused since Orca restarted: \`orca game resume-members ${ticket}\` resumes it, \`orca game resume-members ${ticket} --discard\` frees it.`
      )
    }
    const queued = response.result.queuedMembers?.find((one) => one.ticket === ticket)
    if (queued) {
      throw new RuntimeClientError('invalid_argument', `${ticket} is ${formatSetupQueue(queued)}.`)
    }
    gameLaunchChoiceOf(overrides, response.result.lead ?? DEFAULT_GAME_LEAD)
    const { cap, running } = gameFleetReportOf(response.result)
    if (running >= cap) {
      throw new RuntimeClientError(
        'cap_reached',
        `${running} of ${cap} members are running; close one before launching ${ticket}.`
      )
    }
    const openPrWarning = openPrWarningOf(response.result)
    if (openPrWarning) {
      console.error(`Warning: ${openPrWarning}`)
    }
    const launched = await launchGameMember({
      client,
      state: response.result,
      ticket,
      repo,
      flags,
      cwd,
      prompt,
      overrides,
      remote
    })
    if (!isLaunchUnderway(launched)) {
      process.exitCode = 1
    }
    printResult({ ...response, result: launched }, json, formatGameLaunch)
  }
}
