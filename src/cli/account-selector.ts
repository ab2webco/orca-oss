import { RuntimeClientError, type RuntimeClient } from './runtime-client'
import { getPresentStringFlag } from './flags'
import type { RuntimeAccountsSnapshot } from './account-format'

export type ManagedAccountOption = {
  id: string
  email: string
}

function describeAccounts(accounts: readonly ManagedAccountOption[]): string {
  return accounts.map((account) => `${account.email} (id ${account.id})`).join(', ')
}

/** Resolves an `--claude-account` / `--codex-account` value (email or account id)
 *  to a concrete managed-account id, scoped to one provider's roster. */
export function resolveManagedAccountSelector(args: {
  flag: string
  providerLabel: string
  selector: string
  accounts: readonly ManagedAccountOption[]
}): string {
  const selector = args.selector.trim()
  if (selector.length === 0) {
    throw new RuntimeClientError('invalid_argument', `Missing value for --${args.flag}`)
  }
  if (args.accounts.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--${args.flag} "${selector}" matched nothing: no managed ${args.providerLabel} accounts are configured. Add one in Settings → Accounts, or run \`orca account list --json\`.`
    )
  }
  const byId = args.accounts.find((account) => account.id === selector)
  if (byId) {
    return byId.id
  }
  const byEmail = args.accounts.filter(
    (account) => account.email.toLowerCase() === selector.toLowerCase()
  )
  if (byEmail.length === 1) {
    return byEmail[0].id
  }
  if (byEmail.length > 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--${args.flag} "${selector}" is ambiguous: it matches ${describeAccounts(byEmail)}. Pass the account id instead.`
    )
  }
  throw new RuntimeClientError(
    'invalid_argument',
    `--${args.flag} "${selector}" does not match any ${args.providerLabel} account. Available: ${describeAccounts(args.accounts)}.`
  )
}

export type ResolvedAccountSelectorFlags = {
  claudeAccountId?: string
  codexAccountId?: string
}

/** Reads --claude-account / --codex-account and resolves them against the
 *  runtime's account roster. Returns {} without an RPC when neither is set. */
export async function resolveAccountSelectorFlags(
  flags: Map<string, string | boolean>,
  client: RuntimeClient
): Promise<ResolvedAccountSelectorFlags> {
  const claudeSelector = getPresentStringFlag(flags, 'claude-account')
  const codexSelector = getPresentStringFlag(flags, 'codex-account')
  if (claudeSelector === undefined && codexSelector === undefined) {
    return {}
  }
  const snapshot = await client.call<RuntimeAccountsSnapshot>('accounts.snapshot')
  return {
    ...(claudeSelector !== undefined
      ? {
          claudeAccountId: resolveManagedAccountSelector({
            flag: 'claude-account',
            providerLabel: 'Claude',
            selector: claudeSelector,
            accounts: snapshot.result.claude.accounts
          })
        }
      : {}),
    ...(codexSelector !== undefined
      ? {
          codexAccountId: resolveManagedAccountSelector({
            flag: 'codex-account',
            providerLabel: 'Codex',
            selector: codexSelector,
            accounts: snapshot.result.codex.accounts
          })
        }
      : {})
  }
}
