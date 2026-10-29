import type { CommandHandler } from '../dispatch'
import { accountListEntriesOf, type RuntimeAccountsSnapshot } from '../account-format'
import { resolveManagedAccountSelector } from '../account-selector'
import { RuntimeClientError } from '../runtime-client'
import {
  gameAccountUsagesOf,
  isAutoPickableAccount,
  type GameLaunchedOnAccount
} from '../../shared/orchestrator-game-account-usage'
import type { GameLaunchChoice } from './orchestrator-game-launch-options'
import {
  GAME_ACCOUNT_NEAR_LIMIT_PERCENT,
  gameResetInText,
  pickGameMemberAccount
} from '../../shared/orchestrator-game-account-pick'
import {
  accountProviderOfAgent,
  GAME_ACCOUNT_PROVIDER_LABELS,
  type GameAccountProvider
} from '../../shared/orchestrator-game-member-agent'
import type { GameAgent } from '../../shared/orchestrator-game-state'

type Client = Parameters<CommandHandler>[0]['client']

/** What `auto` weighs besides usage; `exclude` is an account the member must leave. */
export type GameMemberAccountContext = {
  agents: readonly GameAgent[]
  launched?: GameLaunchedOnAccount
  exclude?: string
}

/** The error code of an `auto` pick that found every account at or near its limit. */
export const GAME_ACCOUNTS_LIMITED = 'accounts_limited'

export type GameAccountPin = { claudeAccountId?: string; codexAccountId?: string }

/** The account a member is launched on; `account` is null when Orca's own selection applies. */
export type GameMemberAccountChoice = {
  pin: GameAccountPin
  account: { id: string; email: string } | null
}

// Why bounded: accounts.list waits on provider usage APIs that can stall behind broken auth.
const USAGE_REFRESH_TIMEOUT_MS = 20_000

const NO_ACCOUNT: GameMemberAccountChoice = { pin: {}, account: null }

const pinOf = (provider: GameAccountProvider, id: string): GameAccountPin =>
  provider === 'claude' ? { claudeAccountId: id } : { codexAccountId: id }

const readAccounts = async (client: Client): Promise<RuntimeAccountsSnapshot> =>
  (await client.call<RuntimeAccountsSnapshot>('accounts.snapshot')).result

function namedAccount(
  snapshot: RuntimeAccountsSnapshot,
  provider: GameAccountProvider,
  agent: string,
  selector: string
): GameMemberAccountChoice {
  const other = provider === 'claude' ? 'codex' : 'claude'
  const named = (account: { id: string; email: string }): boolean =>
    account.id === selector || account.email.toLowerCase() === selector.toLowerCase()
  if (!snapshot[provider].accounts.some(named) && snapshot[other].accounts.some(named)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${selector} is a ${GAME_ACCOUNT_PROVIDER_LABELS[other]} account; a ${agent} member needs a ${GAME_ACCOUNT_PROVIDER_LABELS[provider]} account. See \`orca game accounts\`.`
    )
  }
  const id = resolveManagedAccountSelector({
    flag: 'account',
    providerLabel: GAME_ACCOUNT_PROVIDER_LABELS[provider],
    selector,
    accounts: snapshot[provider].accounts
  })
  const email = snapshot[provider].accounts.find((account) => account.id === id)?.email ?? id
  return { pin: pinOf(provider, id), account: { id, email } }
}

async function autoAccount(
  client: Client,
  provider: GameAccountProvider,
  context: GameMemberAccountContext
): Promise<GameMemberAccountChoice> {
  const usagesOf = (snapshot: RuntimeAccountsSnapshot) =>
    gameAccountUsagesOf({
      entries: accountListEntriesOf(snapshot).filter(
        (entry) => isAutoPickableAccount(entry) && entry.id !== context.exclude
      ),
      provider,
      agents: context.agents,
      launched: context.launched
    })
  let usages = usagesOf(await readAccounts(client))
  // Why one refresh: Orca reads an inactive account's usage lazily, so a cold cache would make it look unknown.
  if (usages.some((usage) => usage.session === null && usage.weekly === null)) {
    const refreshed = await client
      .call<RuntimeAccountsSnapshot>(
        'accounts.list',
        { refreshUsage: true },
        { timeoutMs: USAGE_REFRESH_TIMEOUT_MS }
      )
      .catch(() => null)
    usages = refreshed ? usagesOf(refreshed.result) : usages
  }
  const now = Date.now()
  const pick = pickGameMemberAccount(usages, now)
  if (pick.kind === 'none') {
    return NO_ACCOUNT
  }
  if (pick.kind === 'limited') {
    throw new RuntimeClientError(
      GAME_ACCOUNTS_LIMITED,
      `Every ${GAME_ACCOUNT_PROVIDER_LABELS[provider]} account is at or near its limit (${GAME_ACCOUNT_NEAR_LIMIT_PERCENT}%+ of its 5h or 7d window); the first is usable again ${gameResetInText(pick.resetsAt, now)}${pick.resetsAt === null ? '' : ` (${new Date(pick.resetsAt).toISOString()})`}. Wait for it, or name one with --account <email|id>. See \`orca game accounts\`.`
    )
  }
  return { pin: pinOf(provider, pick.account.id), account: pick.account }
}

/** The managed account a new member runs on: the one named, the freest one for `auto`, or Orca's default. */
export async function resolveGameMemberAccount(
  client: Client,
  choice: GameLaunchChoice,
  context: GameMemberAccountContext
): Promise<GameMemberAccountChoice> {
  const provider = accountProviderOfAgent(choice.agent)
  if (choice.account === null || provider === null) {
    return NO_ACCOUNT
  }
  if (choice.account === 'auto') {
    return await autoAccount(client, provider, context)
  }
  return namedAccount(await readAccounts(client), provider, choice.agent, choice.account)
}
