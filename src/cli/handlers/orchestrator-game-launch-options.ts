import { RuntimeClientError } from '../runtime-client'
import { parseGameLead, type OrchestratorGameLead } from '../../shared/orchestrator-game-lead'
import { accountProviderOfAgent } from '../../shared/orchestrator-game-member-agent'
import { isTuiAgent, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'

const LEAD_KEY_PREFIX = 'orchestratorGame.orchestrator.'

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
  /** An email, an account id, or `auto` (the flag, or orchestrator.accounts: auto); null keeps today's selection. */
  account: string | null
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

export function gameLaunchChoiceOf(
  typed: GameLaunchFlags,
  lead: OrchestratorGameLead
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
  return {
    agent,
    ...(model === undefined ? {} : { model }),
    ...(model === undefined || effort === undefined ? {} : { effort }),
    account: typed.account ?? (lead.accounts === 'auto' ? 'auto' : null)
  }
}
