import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD, renderGameLaunchPrompt } from '../../shared/orchestrator-game-lead'
import {
  gameLaunchChoiceOf,
  parseGameLaunchFlags,
  type GameLaunchFlags
} from './orchestrator-game-launch-options'
import { resolveGameMemberAccount } from './orchestrator-game-launch-account'
import { callWithLaunchRetry } from './orchestrator-game-launch-retry'
import { postGameEvents } from './orchestrator-game-board-call'
import { refuseWhileStopped } from './orchestrator-game-hold'
import type { GameLaunchedOnAccount } from './orchestrator-game-account-usage'
import {
  GAME_PROMPT_MAX,
  GAME_WORK_PROMPT_PLACEHOLDERS,
  unknownPlaceholderOf
} from '../../shared/orchestrator-game-actions'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import {
  memberDisplayNameOf,
  memberNameOf,
  memberRosterOf,
  nextMemberName
} from '../../shared/orchestrator-game-member-names'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { RuntimeStatus } from '../../shared/runtime-types'

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
  dispatchId: string
  state: string
  lastError?: string
}

type WorkerStartResult = Pick<
  GameLaunchResult,
  'runId' | 'taskId' | 'dispatchId' | 'state' | 'lastError'
>

const DISPLAY_NAME_MAX = 60

function requiredTicket(flags: Map<string, string | boolean>): string {
  const raw = flags.get('ticket')
  const ticket = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(ticket)) {
    throw new RuntimeClientError('invalid_argument', 'Name the ticket to launch, like CIN-12.')
  }
  return ticket
}

// Why: lets the lead hand a member a task that is not implementing the ticket (tests, QA runs).
function taskPromptOf(flags: Map<string, string | boolean>): string | null {
  if (!flags.has('prompt')) {
    return null
  }
  const raw = flags.get('prompt')
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0 || text.length > GAME_PROMPT_MAX) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--prompt must be 1 to ${GAME_PROMPT_MAX} characters.`
    )
  }
  const unknown = unknownPlaceholderOf(text, GAME_WORK_PROMPT_PLACEHOLDERS)
  if (unknown !== null) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--prompt uses an unknown placeholder {${unknown}}; use {id}, {title}, {url} or {status}.`
    )
  }
  return text
}

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

async function requireLaunchPreferences(client: Client): Promise<void> {
  const status = await client.call<RuntimeStatus>('status.get')
  if (
    !status.result.capabilities?.includes(
      ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
    )
  ) {
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
  const item = state.project?.todo?.items.find((one) => one.id.toUpperCase() === ticket)
  const inUse = state.agents.flatMap((agent) => memberNameOf(agent.displayName) ?? [])
  const name = nextMemberName(
    memberRosterOf(state),
    [...inUse, ...(args.namesTaken ?? [])],
    process.env.ORCA_GAME_LOCALE ?? 'en'
  )
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
  if (choice.model) {
    await requireLaunchPreferences(client)
  }
  const project = state.worktree?.displayName ?? 'this project'
  const runId = await boundRunId(
    client,
    from,
    `${lead.label ?? 'Lead'} of ${project}: one member per ticket`
  )
  const taskParams = {
    spec: renderGameLaunchPrompt(args.prompt ?? lead.launchPrompt, {
      id: item?.id ?? ticket,
      title: item?.title ?? '',
      url: item?.url ?? '',
      status: item?.status
    }),
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
  const workerParams = {
    task: task.result.task.id,
    // Why: a project whose tickets live in other repos (cineco FE/BE) names one; new-child stays in the lead's.
    ...(repo ? { worktree: 'new-top-level', repo } : { worktree: 'new-child' }),
    name: ticket.toLowerCase(),
    displayName: title,
    agent: choice.agent,
    ...(choice.model ? { model: choice.model, effort: choice.effort } : {}),
    ...memberAccount.pin,
    run: runId,
    from,
    devMode: isDevCliInvocation()
  }
  const worker = await callWithLaunchRetry((requestId) =>
    client.call<WorkerStartResult>(
      'orchestration.workerStart',
      workerParams,
      requestId ? { orchestrationRequestId: requestId } : undefined
    )
  )
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
      text: `member ${launched.dispatchId} [${launched.state}] ${[launched.agent, launched.account].filter(Boolean).join(' · ')}`
    }
  ])
  return launched
}

export const formatGameLaunch = (launched: GameLaunchResult): string =>
  `${launched.ticket}${launched.name ? ` (${launched.name})` : ''}: member ${launched.dispatchId} [${launched.state}] ${[launched.agent, launched.account].filter(Boolean).join(' · ')}${launched.lastError ? `\n${launched.lastError}` : ''}`

export const ORCHESTRATOR_GAME_LAUNCH_HANDLERS: Record<string, CommandHandler> = {
  'game launch': async ({ flags, client, cwd, json }) => {
    const ticket = requiredTicket(flags)
    const prompt = taskPromptOf(flags)
    const overrides = parseGameLaunchFlags(flags)
    const rawRepo = flags.get('repo')
    const repo = typeof rawRepo === 'string' && rawRepo.trim() !== '' ? rawRepo.trim() : null
    const response = await readCallerGameState(client)
    refuseWhileStopped(response.result, ticket)
    gameLaunchChoiceOf(overrides, response.result.lead ?? DEFAULT_GAME_LEAD)
    const { cap, running } = gameFleetReportOf(response.result)
    if (running >= cap) {
      throw new RuntimeClientError(
        'cap_reached',
        `${running} of ${cap} members are running; close one before launching ${ticket}.`
      )
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
    if (launched.state !== 'ready') {
      process.exitCode = 1
    }
    printResult({ ...response, result: launched }, json, formatGameLaunch)
  }
}
