import { RuntimeClientError } from '../runtime-client'
import { parseGameLead, type OrchestratorGameLead } from '../../shared/orchestrator-game-lead'
import { accountProviderOfAgent } from '../../shared/orchestrator-game-member-agent'
import { isAllowedGameAccount } from '../../shared/orchestrator-game-account-usage'
import { isTuiAgent, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import {
  GAME_PROMPT_MAX,
  GAME_WORK_PROMPT_PLACEHOLDERS,
  unknownPlaceholderOf
} from '../../shared/orchestrator-game-actions'

const LEAD_KEY_PREFIX = 'orchestratorGame.orchestrator.'

export function requiredTicket(flags: Map<string, string | boolean>): string {
  const raw = flags.get('ticket')
  const ticket = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(ticket)) {
    throw new RuntimeClientError('invalid_argument', 'Name the ticket to launch, like CIN-12.')
  }
  return ticket
}

/** `game launch` / `game wave` overrides as typed, checked before the lead config is read. */
export type GameLaunchFlags = {
  agent?: string
  model?: string
  effort?: string
  account?: string
}

/** What one member runs on: the flags over the project lead config. */
export type GameLaunchChoice = {
  agent: string
  model?: string
  effort?: string
  /** An email, an account id, or `auto` (the flag, or orchestrator.accounts unset or auto); null with accounts: default. */
  account: string | null
  /** What a paired host resolves: only what the flag or orchestrator.accounts named. */
  remoteAccount: string | null
  /** orchestrator.accounts as a list: the only accounts a member may run on. */
  allowedAccounts?: string[]
}

function flagText(flags: Map<string, string | boolean>, name: string): string | undefined {
  if (!flags.has(name)) {
    return undefined
  }
  const raw = flags.get(name)
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') {
    throw new RuntimeClientError('invalid_argument', `Missing a value for --${name}.`)
  }
  return text
}

export function parseGameLaunchFlags(flags: Map<string, string | boolean>): GameLaunchFlags {
  const agent = flagText(flags, 'agent')
  if (agent !== undefined && !isTuiAgent(agent)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Unknown agent "${agent}". Use one Orca knows: ${Object.keys(TUI_AGENT_CONFIG).join(', ')}.`
    )
  }
  const model = flagText(flags, 'model')
  const effort = flagText(flags, 'effort')
  // Why the lead parser: a flag must accept exactly what orchestratorGame.orchestrator accepts.
  const [refusal] = parseGameLead({
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort })
  }).warnings
  if (refusal !== undefined) {
    throw new RuntimeClientError('invalid_argument', `--${refusal.slice(LEAD_KEY_PREFIX.length)}.`)
  }
  const account = flagText(flags, 'account')
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(account === undefined ? {} : { account })
  }
}

export const allowedAccountsText = (allowed: readonly string[]): string =>
  `this project allows only ${allowed.join(', ')} (orchestratorGame.orchestrator.accounts)`

/** A paired host gets only what the project's list allows; until hosts filter `auto`, only a named one. */
function checkRemoteAccountAllowed(choice: GameLaunchChoice, on: string): void {
  const allowed = choice.allowedAccounts
  const named = choice.remoteAccount
  // Why by email: an account id is the host's own, so the home can only match the email the list names.
  if (allowed && (named === null || !isAllowedGameAccount({ id: named, email: named }, allowed))) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${allowedAccountsText(allowed)}; name one of them on ${on} with --account <email>, since ${on} would otherwise pick from all of its accounts.`
    )
  }
}

export function gameLaunchChoiceOf(
  typed: GameLaunchFlags,
  lead: OrchestratorGameLead,
  remote?: { on: string } | null
): GameLaunchChoice {
  const agent = typed.agent ?? lead.agent
  // Why: the lead's model and effort name its own agent's models; another agent gets its defaults.
  const isLeadAgent = agent === lead.agent
  const model = typed.model ?? (isLeadAgent ? lead.model : undefined)
  const effort = typed.effort ?? (isLeadAgent ? lead.effort : undefined)
  if (effort !== undefined && model === undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--effort needs a model: pass --model, or set orchestratorGame.orchestrator.model.'
    )
  }
  if (
    typed.account !== undefined &&
    typed.account !== 'auto' &&
    accountProviderOfAgent(agent) === null
  ) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${agent} has no Orca-managed accounts; --account works for claude and codex members.`
    )
  }
  const choice: GameLaunchChoice = {
    agent,
    ...(model === undefined ? {} : { model }),
    ...(model === undefined || effort === undefined ? {} : { effort }),
    // Why auto when unset: Orca cannot move or refresh a member on the global login (ORCA-809).
    account: typed.account ?? (lead.accounts === 'default' ? null : 'auto'),
    remoteAccount: typed.account ?? (lead.accounts === 'auto' ? 'auto' : null),
    ...(Array.isArray(lead.accounts) ? { allowedAccounts: lead.accounts } : {})
  }
  if (remote) {
    checkRemoteAccountAllowed(choice, remote.on)
  }
  return choice
}

/** `--on <host>`: the paired host a member runs on, in its own worktree of that host's `repo`. */
export type GameRemotePlacement = { on: string; repo: string }

export function remotePlacementOf(
  flags: Map<string, string | boolean>,
  repo: string | null
): GameRemotePlacement | null {
  const on = flagText(flags, 'on')
  if (on === undefined) {
    return null
  }
  // Why: a remote new-top-level needs the host's own repo selector, and no host repo map exists yet.
  if (repo === null) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--on ${on} needs --repo <selector of the repo on ${on}>.`
    )
  }
  return { on, repo }
}

// Why: lets the lead hand a member a task that is not implementing the ticket (tests, QA runs).
export function taskPromptOf(flags: Map<string, string | boolean>): string | null {
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
