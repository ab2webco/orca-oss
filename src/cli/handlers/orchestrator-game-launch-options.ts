import type { CommandHandler } from '../dispatch'
import type { RuntimeAccountsSnapshot } from '../account-format'
import { resolveManagedAccountSelector } from '../account-selector'
import { RuntimeClientError } from '../runtime-client'
import { parseGameLead, type OrchestratorGameLead } from '../../shared/orchestrator-game-lead'
import {
  accountProviderOfAgent,
  GAME_ACCOUNT_PROVIDER_LABELS
} from '../../shared/orchestrator-game-member-agent'
import { isTuiAgent, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'

type Client = Parameters<CommandHandler>[0]['client']

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
  /** An email, an account id, or `auto`; null keeps today's account selection. */
  account: string | null
}

export type GameAccountPin = { claudeAccountId?: string; codexAccountId?: string }

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
  if (typed.account !== undefined && accountProviderOfAgent(agent) === null) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${agent} has no Orca-managed accounts; --account works for claude and codex members.`
    )
  }
  return {
    agent,
    ...(model === undefined ? {} : { model }),
    ...(model === undefined || effort === undefined ? {} : { effort }),
    account: typed.account ?? null
  }
}

/** The worker-start pin for a named account, refused when it is another provider's. */
export async function gameAccountPinOf(
  client: Client,
  choice: GameLaunchChoice
): Promise<GameAccountPin> {
  const provider = accountProviderOfAgent(choice.agent)
  const selector = choice.account
  if (selector === null || provider === null) {
    return {}
  }
  const snapshot = (await client.call<RuntimeAccountsSnapshot>('accounts.snapshot')).result
  const other = provider === 'claude' ? 'codex' : 'claude'
  const named = (account: { id: string; email: string }): boolean =>
    account.id === selector || account.email.toLowerCase() === selector.toLowerCase()
  if (!snapshot[provider].accounts.some(named) && snapshot[other].accounts.some(named)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${selector} is a ${GAME_ACCOUNT_PROVIDER_LABELS[other]} account; a ${choice.agent} member needs a ${GAME_ACCOUNT_PROVIDER_LABELS[provider]} account. See \`orca game accounts\`.`
    )
  }
  const id = resolveManagedAccountSelector({
    flag: 'account',
    providerLabel: GAME_ACCOUNT_PROVIDER_LABELS[provider],
    selector,
    accounts: snapshot[provider].accounts
  })
  return provider === 'claude' ? { claudeAccountId: id } : { codexAccountId: id }
}
