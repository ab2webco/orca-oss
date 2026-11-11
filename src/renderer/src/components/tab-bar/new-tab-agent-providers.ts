import { translate } from '@/i18n/i18n'
import {
  accountListEntriesOf,
  type RuntimeAccountsSnapshot
} from '../../../../shared/managed-account-list-entries'
import { newTabAccountChoiceOf } from '../../../../shared/new-tab-account-choice'
import {
  newTabAccountOptionsOf,
  type NewTabTeamMemberOnAccount
} from '../../../../shared/new-tab-account-options'
import { plainRowAccountOf } from '../../../../shared/new-tab-plain-account'
import type { NewTabAgentProviders } from './new-tab-agent-row-account'

type Provider = 'claude' | 'codex'

export type NewTabAgentProvidersResult = {
  providers: NewTabAgentProviders
  labelOf: (provider: Provider, accountId: string | null) => string
}

/** The + menu's Claude and Codex rows from one accounts snapshot (ORCA-717). */
export function newTabAgentProvidersOf(args: {
  snapshot: RuntimeAccountsSnapshot
  failedProviders?: readonly Provider[]
  pins: Record<Provider, string | null>
  members: readonly NewTabTeamMemberOnAccount[]
  now: number
}): NewTabAgentProvidersResult {
  const entries = accountListEntriesOf(args.snapshot)
  const providerOf = (provider: Provider) => {
    // Why: a failed half is an empty stand-in, not a roster with no accounts.
    if (args.failedProviders?.includes(provider)) {
      return null
    }
    const options = newTabAccountOptionsOf({ entries, provider, members: args.members })
    const resolved = plainRowAccountOf({
      worktreePinId: args.pins[provider],
      globalActiveId: args.snapshot[provider].activeAccountId
    })
    return { choice: newTabAccountChoiceOf(options, args.now), resolvedId: resolved.accountId }
  }
  const labelOf = (provider: Provider, accountId: string | null): string => {
    if (accountId === null) {
      return translate('newTabMenu.account.systemLogin', 'System login')
    }
    const entry = entries.find((one) => one.provider === provider && one.id === accountId)
    return entry?.endpointLabel?.trim() || entry?.email || accountId
  }
  return { providers: { claude: providerOf('claude'), codex: providerOf('codex') }, labelOf }
}
