import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { DEFAULT_GAME_LEAD, type OrchestratorGameLead } from '../../shared/orchestrator-game-lead'
import { gameLeadBriefOf } from '../../shared/orchestrator-game-lead-brief'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { gameStopLabel } from '../../shared/orchestrator-game-stop-state'

type GameLeadResult = {
  role: 'lead' | 'member'
  lead: OrchestratorGameLead
  /** Null for a member: it reports to its lead and never leads. */
  brief: string | null
}

// Why the folder: a primary worktree's display name is its branch, and an SSH path may use either separator.
const projectNameOf = (worktree: OrchestratorGameState['worktree']): string =>
  worktree?.path.split(/[\\/]/).findLast((part) => part !== '') ?? 'this project'

// Why: the game mod runs inside the Agent Teams pane, so the pane's own env names its worktree.
const callerParams = () => ({
  worktreeId: process.env.ORCA_WORKTREE_ID,
  terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
  paneKey: process.env.ORCA_PANE_KEY
})

// Why the env: an older CLI ignores a variable it does not know, where an unknown flag could fail the poll.
const advisorParams = (): { advisor?: unknown } => {
  const raw = process.env.ORCA_GAME_ADVISOR
  if (raw === undefined || raw === '') {
    return {}
  }
  try {
    return { advisor: JSON.parse(raw) as unknown }
  } catch {
    return {}
  }
}

function formatGameState(state: OrchestratorGameState): string {
  const lines = [
    `Game: ${state.config.mode} (scene ${state.config.scene}, mode from ${state.sources.mode})`,
    // Why optional: an older host sends neither key.
    ...(state.config.render === undefined
      ? []
      : [
          `Render: ${state.config.render} (from ${state.sources.render}), timezone ${state.config.timezone} (from ${state.sources.timezone})`
        ]),
    `Agents: ${state.agents.length}`
  ]
  if (state.review) {
    lines.push(
      `Review: ${state.review.provider} #${state.review.number} ${state.review.state}, CI ${state.review.ci}`
    )
  }
  if (state.workItem) {
    lines.push(
      `Work item: ${state.workItem.identifier} ${state.workItem.status || state.workItem.statusGroup}`
    )
  }
  if (state.stopped) {
    lines.push(`${gameStopLabel(state.stopped)}: \`orca game resume\` lifts it`)
  }
  const [mine, ...tickets] = state.inboxes ?? []
  if (mine) {
    const others = tickets.filter((one) => one.unread > 0).map((one) => `${one.key} ${one.unread}`)
    lines.push(`Inbox: ${mine.unread} unread${others.length > 0 ? `; ${others.join(', ')}` : ''}`)
  }
  return [...lines, ...state.warnings.map((warning) => `Warning: ${warning}`)].join('\n')
}

export const ORCHESTRATOR_GAME_HANDLERS: Record<string, CommandHandler> = {
  'game open-link': async ({ flags, client, json }) => {
    const raw = flags.get('url')
    const url = typeof raw === 'string' ? raw.trim() : ''
    if (url === '') {
      throw new RuntimeClientError('invalid_argument', 'Name the url to open.')
    }
    const result = await client.call<{ opened: true }>('game.openLink', { url })
    printResult(result, json, () => `Opened ${url} in the system browser`)
  },
  'game state': async ({ client, json }) => {
    const result = await client.call<OrchestratorGameState>('game.state', {
      ...callerParams(),
      ...advisorParams()
    })
    printResult(result, json, formatGameState)
  },
  'game lead': async ({ client, json }) => {
    const response = await client.call<OrchestratorGameState>('game.state', callerParams())
    const state = response.result
    const lead = state.lead ?? DEFAULT_GAME_LEAD
    const role = state.role ?? 'lead'
    const project = projectNameOf(state.worktree)
    const brief =
      role === 'member' ? null : gameLeadBriefOf(lead, project, process.env.ORCA_GAME_CLI || 'orca')
    if (role !== 'member') {
      // Why quiet: an older host has no directory, and the brief must still print.
      await client
        .call('game.leadRegister', {
          worktreeId: process.env.ORCA_WORKTREE_ID,
          terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
          project,
          label: lead.label ?? ''
        })
        .catch(() => undefined)
    }
    printResult<GameLeadResult>(
      { ...response, result: { role, lead, brief } },
      json,
      (result) =>
        result.brief ??
        'This session was launched by a lead: work your ticket and report to it, never lead.'
    )
  }
}
