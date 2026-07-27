import type { CommandHandler } from '../dispatch'
import {
  buildAccountListReport,
  formatAccountList,
  type RuntimeAccountsSnapshot
} from '../account-format'
import { printResult } from '../format'

export const ACCOUNT_HANDLERS: Record<string, CommandHandler> = {
  'account list': async ({ flags, client, json }) => {
    // Why: accounts.list force-refreshes provider usage and can stall behind
    // broken auth; the cached snapshot is the safe default for scripted callers.
    const method = flags.get('refresh') === true ? 'accounts.list' : 'accounts.snapshot'
    const response = await client.call<RuntimeAccountsSnapshot>(method)
    printResult(
      { ...response, result: buildAccountListReport(response.result) },
      json,
      formatAccountList
    )
  }
}
