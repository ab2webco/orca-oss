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
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'

type Client = Parameters<CommandHandler>[0]['client']

/** What `auto` weighs besides usage; `exclude` is an account the member must leave. */
export type GameMemberAccountContext = {
  agents: readonly GameAgent[]
  launched?: GameLaunchedOnAccount
  exclude?: string
  /** A launch: with no managed account at all, `auto` may use the global login unless this member holds it. */
  globalLoginHolder?: string | null
}

/** How `game fleet` and a launch name the host's own login, which no managed account owns. */
export const GAME_GLOBAL_LOGIN_LABEL = 'global login'

/** The error code of an `auto` pick that found every account at or near its limit. */
export const GAME_ACCOUNTS_LIMITED = 'accounts_limited'
export const GAME_ACCOUNTS_UNUSABLE = 'accounts_unusable'
export const GAME_GLOBAL_LOGIN_TAKEN = 'global_login_taken'

export type GameAccountPin = { claudeAccountId?: string; codexAccountId?: string }

/** The account a member is launched on; `account` is null when Orca's own selection applies. */
export type GameMemberAccountChoice = {
  pin: GameAccountPin
  account: { id: string; email: string } | null
  /** No managed account exists, so the member runs on the host's global login. */
  globalLogin?: true
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

/** The member already on the global login for this agent's provider, if any; one at a time. */
export function globalLoginHolderOf(
  agents: readonly GameAgent[],
  agent: string,
  launchedThere: readonly string[]
): string | null {
  const provider = accountProviderOfAgent(agent)
  const holders = agents
    .filter(
      (one) =>
        one.isMember &&
        !one.isLeader &&
        one.globalLogin === true &&
        accountProviderOfAgent(one.agentType) === provider
    )
    .map((one) => ticketOfMember(one) ?? one.displayName ?? one.paneKey)
  return [...holders, ...launchedThere][0] ?? null
}

// Why: Orca cannot refresh, move or switch a member on the global login (ORCA-809).
function globalLoginChoice(
  snapshot: RuntimeAccountsSnapshot,
  provider: GameAccountProvider,
  holder: string | null
): GameMemberAccountChoice {
  const label = GAME_ACCOUNT_PROVIDER_LABELS[provider]
  if (snapshot[provider].accounts.length > 0) {
    throw new RuntimeClientError(
      GAME_ACCOUNTS_UNUSABLE,
      `No managed ${label} account here can take a member (each is on WSL, a custom endpoint, or its sign-in failed), and Orca does not fall back to the global login while managed accounts exist. Name one with --account <email|id>, or fix its sign-in. See \`orca game accounts\`.`
    )
  }
  if (holder !== null) {
    throw new RuntimeClientError(
      GAME_GLOBAL_LOGIN_TAKEN,
      `No managed ${label} account here, and ${holder} already runs on the global login; Orca puts one member there at a time because it cannot move or refresh it. Add an account in Settings → Accounts, or wait for ${holder}.`
    )
  }
  return { ...NO_ACCOUNT, globalLogin: true }
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
  let snapshot = await readAccounts(client)
  let usages = usagesOf(snapshot)
  // Why one refresh: Orca reads an inactive account's usage lazily, so a cold cache would make it look unknown.
  if (usages.some((usage) => usage.session === null && usage.weekly === null)) {
    const refreshed = await client
      .call<RuntimeAccountsSnapshot>(
        'accounts.list',
        { refreshUsage: true },
        { timeoutMs: USAGE_REFRESH_TIMEOUT_MS }
      )
      .catch(() => null)
    snapshot = refreshed?.result ?? snapshot
    usages = usagesOf(snapshot)
  }
  const now = Date.now()
  const pick = pickGameMemberAccount(usages, now)
  if (pick.kind === 'none') {
    return context.globalLoginHolder === undefined
      ? NO_ACCOUNT
      : globalLoginChoice(snapshot, provider, context.globalLoginHolder)
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
  choice: Pick<GameLaunchChoice, 'agent' | 'account'>,
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
