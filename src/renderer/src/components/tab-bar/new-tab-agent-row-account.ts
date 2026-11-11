import type {
  NewTabAccountChoice,
  NewTabAccountRow
} from '../../../../shared/new-tab-account-choice'

/** One provider's accounts and the account a plain launch would resolve to today. */
export type NewTabProviderAccounts = { choice: NewTabAccountChoice; resolvedId: string | null }

export type NewTabAgentProviders = {
  claude: NewTabProviderAccounts | null
  codex: NewTabProviderAccounts | null
}

export type AgentRowAccount =
  | { kind: 'loading' }
  | { kind: 'own-login' }
  | { kind: 'host-login' }
  | {
      kind: 'picker'
      provider: 'claude' | 'codex'
      rows: NewTabAccountRow[]
      checkedId: string | null
    }

// Why string keys: a project's member agent comes from orca.yaml, which may name any CLI.
const MANAGED_PROVIDER: Partial<Record<string, 'claude' | 'codex'>> = {
  claude: 'claude',
  'claude-agent-teams': 'claude',
  codex: 'codex'
}

// Why checkedId is the resolved account: a plain row launches as today unless a person picks (ORCA-717).
export function agentRowAccountOf(args: {
  agent: string
  local: boolean
  providers: NewTabAgentProviders
  /** `member-default`: the team's rows check the member pick (pickGameMemberAccount) instead. */
  checked?: 'resolved' | 'member-default'
}): AgentRowAccount {
  const provider = MANAGED_PROVIDER[args.agent]
  if (!provider) {
    return { kind: 'own-login' }
  }
  // Why: the account override only reaches a local spawn; elsewhere the host resolves its own.
  if (!args.local) {
    return { kind: 'host-login' }
  }
  const accounts = args.providers[provider]
  if (!accounts) {
    return { kind: 'loading' }
  }
  if (accounts.choice.kind === 'own-login') {
    return { kind: 'own-login' }
  }
  const { choice } = accounts
  const checkedId = args.checked === 'member-default' ? choice.defaultId : accounts.resolvedId
  return { kind: 'picker', provider, rows: choice.rows, checkedId }
}
