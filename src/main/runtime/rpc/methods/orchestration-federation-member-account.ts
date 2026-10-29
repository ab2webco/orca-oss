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
export type FederatedMemberAccount = {
  pin: { claudeAccountId?: string; codexAccountId?: string }
  account: { provider: GameAccountProvider; email: string }
}

const ADD_HINT = 'register one on this host with `orca account add`'

/** The account a remote member runs on, from this host's own roster; never its global login. */
export function resolveFederatedMemberAccount(args: {
  entries: readonly AccountListEntry[]
  agent: string | undefined
  selector: string
  now: number
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
  const chosen =
    args.selector === FEDERATED_AUTO_ACCOUNT
      ? autoEntry(entries, provider, label, args.now)
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
  entries: readonly AccountListEntry[],
  provider: GameAccountProvider,
  label: string,
  now: number
): { id: string; email: string } {
  const usages = gameAccountUsagesOf({
    entries: entries.filter(isAutoPickableAccount),
    provider,
    agents: []
  })
  const pick = pickGameMemberAccount(usages, now)
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
  throw new OrchestrationError(
    'invalid_argument',
    `No usable ${label} account on this host; ${ADD_HINT}.`
  )
}

// Why bounded: a usage refresh waits on provider APIs that can stall behind broken auth.
const USAGE_REFRESH_TIMEOUT_MS = 20_000

/** Resolves a home's typed selector on this host, before the attachment creates anything. */
export async function resolveHostMemberAccount(args: {
  runtime: Pick<OrcaRuntimeService, 'getAccountsSnapshot' | 'refreshAccountsForMobile'>
  agent: string | undefined
  selector: string
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
    now: Date.now()
  })
}
