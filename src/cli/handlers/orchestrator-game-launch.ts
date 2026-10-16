import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { renderGameWorkPrompt } from '../../shared/orchestrator-game-actions'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { RuntimeStatus } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

type GameLaunchResult = {
  ticket: string
  runId: string
  taskId: string
  dispatchId: string
  state: string
  lastError?: string
}

const DISPLAY_NAME_MAX = 60

function requiredTicket(flags: Map<string, string | boolean>): string {
  const raw = flags.get('ticket')
  const ticket = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(ticket)) {
    throw new RuntimeClientError('invalid_argument', 'Name the ticket to launch, like CIN-12.')
  }
  return ticket
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

export const ORCHESTRATOR_GAME_LAUNCH_HANDLERS: Record<string, CommandHandler> = {
  'game launch': async ({ flags, client, cwd, json }) => {
    const ticket = requiredTicket(flags)
    const { result: state } = await client.call<OrchestratorGameState>('game.state', {
      worktreeId: process.env.ORCA_WORKTREE_ID,
      terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
      paneKey: process.env.ORCA_PANE_KEY
    })
    const lead = state.lead ?? DEFAULT_GAME_LEAD
    const running = state.agents.filter((agent) => agent.isMember && agent.state !== 'done').length
    if (running >= lead.cap) {
      throw new RuntimeClientError(
        'cap_reached',
        `${running} of ${lead.cap} members are running; close one before launching ${ticket}.`
      )
    }
    const item = state.project?.todo?.items.find((one) => one.id.toUpperCase() === ticket)
    const title = item ? `${item.id} ${item.title}`.slice(0, DISPLAY_NAME_MAX) : ticket
    const from = await resolveCoordinatorTerminalHandle(flags, cwd, client)
    if (lead.model) {
      await requireLaunchPreferences(client)
    }
    const project = state.worktree?.displayName ?? 'this project'
    const runId = await boundRunId(
      client,
      from,
      `${lead.label ?? 'Lead'} of ${project}: one member per ticket`
    )
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: renderGameWorkPrompt(lead.launchPrompt, {
        id: item?.id ?? ticket,
        title: item?.title ?? '',
        url: item?.url ?? '',
        status: item?.status
      }),
      taskTitle: title,
      callerTerminalHandle: from
    })
    const worker = await client.call<Omit<GameLaunchResult, 'ticket'>>(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        worktree: 'new-child',
        name: ticket.toLowerCase(),
        displayName: title,
        agent: lead.agent,
        ...(lead.model ? { model: lead.model, effort: lead.effort } : {}),
        run: runId,
        from,
        devMode: isDevCliInvocation()
      }
    )
    if (worker.result.state !== 'ready') {
      process.exitCode = 1
    }
    printResult(
      { ...worker, result: { ticket, ...worker.result } },
      json,
      (launched) =>
        `${launched.ticket}: member ${launched.dispatchId} [${launched.state}]${launched.lastError ? `\n${launched.lastError}` : ''}`
    )
  }
}
