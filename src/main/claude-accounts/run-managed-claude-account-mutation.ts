import { AsyncLocalStorage } from 'node:async_hooks'
import {
  beginManagedClaudeAccountMutation,
  endManagedClaudeAccountMutation,
  isManagedClaudeAccountMutating
} from './live-pty-gate'

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

/**
 * Best-effort variant for short mutations embedded in read paths (e.g. a usage
 * read's token rotation): acquires the same gate, but yields — `acquired: false`
 * instead of throwing — when a live session, launch reservation, or mutation
 * already owns the account. The atomic acquire re-checks liveness, closing the
 * race where a Claude launch starts between a caller's liveness check and the
 * rotation it guards.
 */
export async function tryRunManagedClaudeAccountMutation<T>(
  accountId: string,
  operation: () => Promise<T>
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const inherited = managedClaudeAccountMutationContext.getStore()
  if (inherited?.has(accountId)) {
    return { acquired: true, value: await operation() }
  }
  try {
    beginManagedClaudeAccountMutation(accountId)
  } catch {
    return { acquired: false }
  }
  try {
    return {
      acquired: true,
      value: await managedClaudeAccountMutationContext.run(
        new Set([...(inherited ?? []), accountId]),
        operation
      )
    }
  } finally {
    endManagedClaudeAccountMutation(accountId)
  }
}

/**
 * Runs a READ against a managed account, serialized against mutations of that
 * same account but without the live-PTY gate.
 *
 * Why: the gate exists to stop an account from being *changed* under a running
 * Claude terminal. A usage read changes nothing, so applying the gate to it made
 * the usage of every worktree-pinned account with an open terminal permanently
 * unreadable — exactly the account the user wants to see. Waiting on an
 * in-flight mutation is still required so a read can't observe half-swapped
 * credentials, so the read yields to the mutation instead of racing it.
 */
export async function runManagedClaudeAccountRead<T>(
  accountId: string,
  operation: () => Promise<T>
): Promise<T> {
  const inherited = managedClaudeAccountMutationContext.getStore()
  if (inherited?.has(accountId)) {
    return operation()
  }
  if (isManagedClaudeAccountMutating(accountId)) {
    // Why: a read must not interleave with an in-flight credential swap; skipping
    // it lets the caller retry on its next cycle with settled credentials.
    throw new Error('This Claude account is already being changed.')
  }
  return operation()
}
