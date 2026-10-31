import {
  accountListEntriesOf,
  type AccountListEntry
} from '../../../../shared/managed-account-list-entries'
import {
  gameAccountUsagesOf,
  isAutoPickableAccount
} from '../../../../shared/orchestrator-game-account-usage'
import {
  GAME_ACCOUNT_NEAR_LIMIT_PERCENT,
  pickGameMemberAccount
} from '../../../../shared/orchestrator-game-account-pick'
import {
  accountProviderOfAgent,
  GAME_ACCOUNT_PROVIDER_LABELS,
  type GameAccountProvider
} from '../../../../shared/orchestrator-game-member-agent'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'

/** The selector a home forwards for `auto`; anything else names an account on this host. */
export const FEDERATED_AUTO_ACCOUNT = 'auto'

/** Only the email goes back to the home: account ids stay on the host that owns them. */
export type FederatedMemberAccount =
  | {
      pin: { claudeAccountId?: string; codexAccountId?: string }
      account: { provider: GameAccountProvider; email: string }
      globalLogin?: undefined
    }
  /** `auto` on a host with no managed account: the member runs on its global login (ORCA-891). */
  | { pin: Record<string, never>; account: null; globalLogin: GameAccountProvider }

const ADD_HINT = 'register one on this host with `orca account add`'

/** The account a remote member runs on, from this host's own roster; its global login only when it has none. */
export function resolveFederatedMemberAccount(args: {
  entries: readonly AccountListEntry[]
  agent: string | undefined
  selector: string
  now: number
  /** The project's orchestrator.accounts list, which `auto` picks from. */
  allowed?: readonly string[]
  /** This host's agents, so `auto` weighs its members and skips an account one stopped on. */
  agents?: Parameters<typeof gameAccountUsagesOf>[0]['agents']
}): FederatedMemberAccount {
  const provider = accountProviderOfAgent(args.agent)
  if (provider === null) {
    throw new OrchestrationError(
      'invalid_argument',
      `${args.agent ?? 'This agent'} has no Orca-managed accounts; launch it without --account.`
    )
  }
  const label = GAME_ACCOUNT_PROVIDER_LABELS[provider]
  const entries = args.entries.filter((entry) => entry.provider === provider)
  if (args.selector === FEDERATED_AUTO_ACCOUNT && entries.length === 0 && !args.allowed) {
    return { pin: {}, account: null, globalLogin: provider }
  }
  const chosen =
    args.selector === FEDERATED_AUTO_ACCOUNT
      ? autoEntry(args, provider, label)
      : namedEntry(entries, label, args.selector)
  return {
    pin: provider === 'claude' ? { claudeAccountId: chosen.id } : { codexAccountId: chosen.id },
    account: { provider, email: chosen.email }
  }
}

function namedEntry(
  entries: readonly AccountListEntry[],
  label: string,
  selector: string
): { id: string; email: string } {
  const named = entries.find(
    (entry) => entry.id === selector || entry.email.toLowerCase() === selector.toLowerCase()
  )
  if (!named) {
    throw new OrchestrationError(
      'invalid_argument',
      `${selector} is not a ${label} account on this host; ${ADD_HINT}, or name one \`orca account list\` shows there.`
    )
  }
  if (named.auth?.state === 'failed') {
    throw new OrchestrationError(
      'invalid_argument',
      `${named.email}'s sign-in failed on this host; sign it in again there or name another account.`
    )
  }
  return named
}

function autoEntry(
  args: Parameters<typeof resolveFederatedMemberAccount>[0],
  provider: GameAccountProvider,
  label: string
): { id: string; email: string } {
  const usages = gameAccountUsagesOf({
    entries: args.entries.filter(isAutoPickableAccount),
    provider,
    agents: args.agents ?? [],
    allowed: args.allowed
  })
  const pick = pickGameMemberAccount(usages, args.now)
  if (pick.kind === 'account') {
    return pick.account
  }
  if (pick.kind === 'limited') {
    throw new OrchestrationError(
      'accounts_limited',
      `Every ${label} account on this host is at or near its limit (${GAME_ACCOUNT_NEAR_LIMIT_PERCENT}%+ of its 5h or 7d window)${pick.resetsAt === null ? '' : `; the first is usable again at ${new Date(pick.resetsAt).toISOString()}`}.`,
      { resetsAt: pick.resetsAt }
    )
  }
  const allowed = args.allowed ? ` the project allows (${args.allowed.join(', ')})` : ''
  // Why no fallback: a member on the global login cannot be moved or refreshed (ORCA-809).
  throw new OrchestrationError(
    'accounts_unusable',
    `No ${label} account${allowed} on this host can take a member (none is there, or each is on WSL, a custom endpoint, or its sign-in failed), and Orca does not fall back to the global login while managed accounts exist or the project lists its own; fix one's sign-in there, or name one \`orca account list\` shows.`
  )
}

// Why bounded: a usage refresh waits on provider APIs that can stall behind broken auth.
const USAGE_REFRESH_TIMEOUT_MS = 20_000

/** Resolves a home's typed selector on this host, before the attachment creates anything. */
export async function resolveHostMemberAccount(args: {
  runtime: Pick<
    OrcaRuntimeService,
    'getAccountsSnapshot' | 'refreshAccountsForMobile' | 'gameAgentsOnAccounts'
  >
  agent: string | undefined
  selector: string
  allowed?: readonly string[]
  reusesTerminal: boolean
}): Promise<FederatedMemberAccount> {
  if (args.reusesTerminal) {
    throw new OrchestrationError(
      'invalid_argument',
      'An account cannot be set on a reused terminal; its agent already runs on one.'
    )
  }
  let entries = accountListEntriesOf(args.runtime.getAccountsSnapshot())
  // Why one refresh: Orca reads an inactive account's usage lazily, so a cold cache would look unknown.
  if (args.selector === FEDERATED_AUTO_ACCOUNT && entries.some((entry) => entry.quota === null)) {
    await Promise.race([
      args.runtime.refreshAccountsForMobile().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, USAGE_REFRESH_TIMEOUT_MS).unref?.())
    ])
    entries = accountListEntriesOf(args.runtime.getAccountsSnapshot())
  }
  return resolveFederatedMemberAccount({
    entries,
    agent: args.agent,
    selector: args.selector,
    now: Date.now(),
    allowed: args.allowed,
    agents:
      args.selector === FEDERATED_AUTO_ACCOUNT
        ? await args.runtime.gameAgentsOnAccounts().catch(() => [])
        : []
  })
}
