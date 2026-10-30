import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { DEFAULT_GAME_LEAD, type OrchestratorGameLead } from '../../shared/orchestrator-game-lead'
import { gameLeadBriefOf } from '../../shared/orchestrator-game-lead-brief'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { gameStopLabel } from '../../shared/orchestrator-game-stop-state'
import { withGameMemberIdentity } from '../../shared/orchestrator-game-member-identity'

type GameLeadRegistration = {
  registered?: boolean
  live?: { handle: string }
  resumed?: { handle: string }
  resumeError?: string
}

type GameLeadResult = {
  role: 'lead' | 'member'
  lead: OrchestratorGameLead
  /** Null for a member, and for a pane that is not the project's lead: another one is. */
  brief: string | null
  outcome?: 'live' | 'resumed'
  handle?: string
  resumeError?: string
  fresh?: boolean
}

// Why the prefix: the game mod reads it to keep this session from counting as the lead.
const NOT_LEAD = 'Not the lead:'

function leadOutcomeText(result: GameLeadResult, project: string): string | null {
  if (result.outcome === 'live') {
    const rotate = result.fresh
      ? ' To rotate, close that lead, then run `orca game lead --fresh` again here.'
      : ''
    return `${NOT_LEAD} ${project}'s lead is live in another pane (${result.handle}), and Orca focused it. Keep working here as a plain session.${rotate}`
  }
  if (result.outcome === 'resumed') {
    // Why: a host that never answers `resumed` to a fresh claim is one that dropped the flag.
    const old = result.fresh ? ' (this Orca host does not support --fresh)' : ''
    return `${NOT_LEAD} Orca reopened ${project}'s lead conversation in a new tab (${result.handle}), with its context${old}. Use that tab; this one is a plain session.`
  }
  return null
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
    const response = await client.call<OrchestratorGameState>('game.state', {
      ...callerParams(),
      ...advisorParams()
    })
    // Why here, not on the host: an older host's members get the fields too.
    printResult(
      { ...response, result: withGameMemberIdentity(response.result) },
      json,
      formatGameState
    )
  },
  'game lead': async ({ flags, client, json }) => {
    const fresh = flags.get('fresh') === true
    const response = await client.call<OrchestratorGameState>('game.state', callerParams())
    const state = response.result
    const lead = state.lead ?? DEFAULT_GAME_LEAD
    const role = state.role ?? 'lead'
    const project = projectNameOf(state.worktree)
    let registration: GameLeadRegistration = {}
    if (role !== 'member') {
      // Why quiet: an older host has no directory, and the brief must still print.
      registration =
        (await client
          .call<GameLeadRegistration>('game.leadRegister', {
            worktreeId: process.env.ORCA_WORKTREE_ID,
            terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
            project,
            label: lead.label ?? '',
            claim: true,
            ...(fresh ? { fresh: true } : {})
          })
          .then((one) => one.result)
          .catch(() => undefined)) ?? {}
    }
    const elsewhere = registration.live ?? registration.resumed
    const result: GameLeadResult = {
      role,
      lead,
      brief:
        role === 'member' || elsewhere
          ? null
          : gameLeadBriefOf(lead, project, process.env.ORCA_GAME_CLI || 'orca'),
      ...(elsewhere
        ? { outcome: registration.live ? 'live' : 'resumed', handle: elsewhere.handle }
        : {}),
      ...(registration.resumeError ? { resumeError: registration.resumeError } : {}),
      ...(fresh ? { fresh: true } : {})
    }
    printResult<GameLeadResult>({ ...response, result }, json, (one) => {
      if (one.role === 'member') {
        return 'This session was launched by a lead: work your ticket and report to it, never lead.'
      }
      const notLead = leadOutcomeText(one, project)
      if (notLead !== null || one.brief === null) {
        return notLead ?? ''
      }
      if (one.resumeError) {
        return `Orca could not reopen ${project}'s previous lead conversation (${one.resumeError}), so this session is a new lead.\n\n${one.brief}`
      }
      return one.fresh
        ? `Orca retired ${project}'s previous lead conversation, so this session is the new lead.\n\n${one.brief}`
        : one.brief
    })
  }
}
