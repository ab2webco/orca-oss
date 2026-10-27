import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { openPrWarningOf } from '../../shared/orchestrator-game-open-prs'
import { DEFAULT_GAME_LEAD, renderGameLaunchPrompt } from '../../shared/orchestrator-game-lead'
import {
  gameLaunchChoiceOf,
  parseGameLaunchFlags,
  requiredTicket,
  taskPromptOf,
  type GameLaunchFlags
} from './orchestrator-game-launch-options'
import { resolveGameMemberAccount } from './orchestrator-game-launch-account'
import { callWithLaunchRetry } from './orchestrator-game-launch-retry'
import { memberWorktreeParamsOf } from './orchestrator-game-launch-worktree'
import { gameBoardCaller, postGameEvents, recordGameMember } from './orchestrator-game-board-call'
import { refuseWhileStopped } from './orchestrator-game-hold'
import { gameLessonBriefFor, withGameLessons } from './orchestrator-game-lessons-call'
import type { GameLaunchedOnAccount } from './orchestrator-game-account-usage'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import {
  memberDisplayNameOf,
  memberNameOf,
  memberRosterOf,
  nextMemberName
} from '../../shared/orchestrator-game-member-names'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import {
  formatSetupQueue,
  runtimeCapabilitiesOf,
  setupAdmissionOf,
  type GameSetupQueue
} from './orchestrator-game-setup-queue'

type Client = Parameters<CommandHandler>[0]['client']

export type GameLaunchResult = {
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
> & { effects?: { kind: string; id?: string }[] }

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

// Why: the game mod runs inside the Agent Teams pane, so the pane's own env names its worktree.
export const readCallerGameState = (client: Client) =>
  client.call<OrchestratorGameState>('game.state', {
    worktreeId: process.env.ORCA_WORKTREE_ID,
    terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
    paneKey: process.env.ORCA_PANE_KEY
  })

// Why the host picks: it sees every lead's members and holds the pick against a concurrent launch.
async function memberNameFor(
  client: Client,
  state: OrchestratorGameState,
  ticket: string,
  taken: readonly string[]
): Promise<string | null> {
  const roster = memberRosterOf(state)
  const locale = process.env.ORCA_GAME_LOCALE ?? 'en'
  const reserved = await client
    .call<{ name?: unknown }>('game.memberNameReserve', {
      ...gameBoardCaller(),
      ticket,
      roster,
      locale,
      taken
    })
    .then(
      (response) => response.result,
      () => undefined
    )
  // Why a local pick on any failure: an older Orca cannot reserve, and a name never blocks a launch.
  return reserved?.name === null || typeof reserved?.name === 'string'
    ? reserved.name
    : nextMemberName(roster, taken, locale)
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
}): Promise<GameLaunchResult> {
  const { client, state, ticket, repo } = args
  const lead = state.lead ?? DEFAULT_GAME_LEAD
  const choice = gameLaunchChoiceOf(args.overrides ?? {}, lead)
  const where = await memberWorktreeParamsOf({ client, state, ticket, repo })
  const item = state.project?.todo?.items.find((one) => one.id.toUpperCase() === ticket)
  const inUse = state.agents.flatMap((agent) => memberNameOf(agent.displayName) ?? [])
  const name = await memberNameFor(client, state, ticket, [...inUse, ...(args.namesTaken ?? [])])
  const title = memberDisplayNameOf(
    name,
    item ? `${item.id} ${item.title}` : ticket,
    DISPLAY_NAME_MAX,
    item?.id ?? ticket
  )
  const memberAccount = await resolveGameMemberAccount(client, choice, {
    agents: state.agents,
    launched: args.launched
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
      renderGameLaunchPrompt(args.prompt ?? lead.launchPrompt, {
        id: item?.id ?? ticket,
        title: item?.title ?? '',
        url: item?.url ?? '',
        status: item?.status
      }),
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
  const workerParams = {
    task: task.result.task.id,
    ...where,
    name: ticket.toLowerCase(),
    displayName: title,
    agent: choice.agent,
    ...(choice.model ? { model: choice.model, effort: choice.effort } : {}),
    ...memberAccount.pin,
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
  )
  await recordGameMember(client, {
    ticket,
    dispatchId: worker.result.dispatchId,
    worktreeId: worker.result.effects?.find((one) => one.kind === 'worktree')?.id,
    lastState: worker.result.state
  })
  const launched: GameLaunchResult = {
    ticket,
    ...(name === null ? {} : { name }),
    agent: choice.agent,
    ...(memberAccount.account
      ? { account: memberAccount.account.email, accountId: memberAccount.account.id }
      : {}),
    ...worker.result
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
  const who = [launched.agent, launched.account].filter(Boolean).join(' · ')
  const what = launched.setupQueue
    ? formatSetupQueue(launched.setupQueue, who)
    : `member ${launched.dispatchId} [${launched.state}] ${who}`
  return `${launched.ticket}${launched.name ? ` (${launched.name})` : ''}: ${what}${launched.lastError ? `\n${launched.lastError}` : ''}`
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
      overrides
    })
    if (!isLaunchUnderway(launched)) {
      process.exitCode = 1
    }
    printResult({ ...response, result: launched }, json, formatGameLaunch)
  }
}
