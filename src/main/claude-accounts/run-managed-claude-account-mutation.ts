import { AsyncLocalStorage } from 'node:async_hooks'
import { beginManagedClaudeAccountMutation, endManagedClaudeAccountMutation } from './live-pty-gate'

// Why: nested managed mutations (e.g. a switch that spawns a refresh) must not
// re-acquire the gate for an account already held by an outer mutation on the
// same async chain; the context tracks accounts owned up the call stack.
const managedClaudeAccountMutationContext = new AsyncLocalStorage<ReadonlySet<string>>()

export async function runManagedClaudeAccountMutation<T>(
  accountId: string,
  operation: () => Promise<T>,
  allowLiveSharedPtys = false
): Promise<T> {
  const inherited = managedClaudeAccountMutationContext.getStore()
  if (inherited?.has(accountId)) {
    return operation()
  }
  beginManagedClaudeAccountMutation(accountId, allowLiveSharedPtys)
  try {
    return await managedClaudeAccountMutationContext.run(
      new Set([...(inherited ?? []), accountId]),
      operation
    )
  } finally {
    endManagedClaudeAccountMutation(accountId)
  }
}
