import type {
  ClaudeLivePtyAccountBinding,
  ClaudeLiveSharedPtyAccountBinding,
  CodexDirectedPtyAccountBinding
} from '../../../shared/managed-account-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { StoreOwnedPersistedState } from '../loading-store/store-owned-state'
import { MAX_CLAUDE_LIVE_PTY_SESSION_IDS } from '../restoring-sessions/pane-alias-normalization'

export type ManagedAccountPtyBindingOperations = {
  state: StoreOwnedPersistedState
  scheduleSave: () => void
  flushOrThrow: () => void
}

export function normalizeClaudeLivePtyAccountBindings(
  value: unknown
): ClaudeLivePtyAccountBinding[] {
  if (!Array.isArray(value)) {
    return []
  }
  const bindings: ClaudeLivePtyAccountBinding[] = []
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const candidate = value[index] as Partial<ClaudeLivePtyAccountBinding> | null
    if (
      !candidate ||
      typeof candidate.sessionId !== 'string' ||
      candidate.sessionId.length === 0 ||
      candidate.sessionId.length > 512 ||
      typeof candidate.accountId !== 'string' ||
      candidate.accountId.length === 0 ||
      candidate.accountId.length > 512 ||
      bindings.some((entry) => entry.sessionId === candidate.sessionId)
    ) {
      continue
    }
    bindings.push({ sessionId: candidate.sessionId, accountId: candidate.accountId })
    if (bindings.length >= MAX_CLAUDE_LIVE_PTY_SESSION_IDS) {
      break
    }
  }
  return bindings.toReversed()
}

export function normalizeCodexDirectedPtyAccountBindings(
  value: unknown
): CodexDirectedPtyAccountBinding[] {
  // Why the same shape as the Claude one: both answer "does a surviving daemon
  // session belong to a pinned account", and both are read at startup before
  // any pane restores.
  return normalizeClaudeLivePtyAccountBindings(value)
}

export function normalizeClaudeLiveSharedPtyAccountBindings(
  value: unknown
): ClaudeLiveSharedPtyAccountBinding[] {
  if (!Array.isArray(value)) {
    return []
  }
  const bindings: ClaudeLiveSharedPtyAccountBinding[] = []
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const candidate = value[index] as Partial<ClaudeLiveSharedPtyAccountBinding> | null
    if (
      !candidate ||
      typeof candidate.sessionId !== 'string' ||
      candidate.sessionId.length === 0 ||
      candidate.sessionId.length > 512 ||
      (candidate.accountId !== null &&
        (typeof candidate.accountId !== 'string' ||
          candidate.accountId.length === 0 ||
          candidate.accountId.length > 512)) ||
      bindings.some((entry) => entry.sessionId === candidate.sessionId)
    ) {
      continue
    }
    const accountId = candidate.accountId ?? null
    // Why a non-null accountId is always resolved: only null is ambiguous.
    const accountResolved = accountId !== null || candidate.accountResolved === true
    bindings.push({
      sessionId: candidate.sessionId,
      accountId,
      ...(accountResolved ? { accountResolved: true } : {})
    })
    if (bindings.length >= MAX_CLAUDE_LIVE_PTY_SESSION_IDS) {
      break
    }
  }
  return bindings.toReversed()
}

export type PtySpawnAccountBindingArgs = {
  ptyId: string
  claudeAccountId?: string
  claudeSharedAccountId?: string | null
  /** Set only by an explicit `--codex-account` launch (ORCA-130). */
  codexDirectedAccountId?: string
}

export type PtyAccountBindingSnapshot = {
  claudeBindings: ClaudeLivePtyAccountBinding[]
  sharedClaudeIds: string[]
  sharedClaudeBindings: ClaudeLiveSharedPtyAccountBinding[]
  codexDirectedBindings: CodexDirectedPtyAccountBinding[]
}

export function snapshotPtyAccountBindings(state: PersistedState): PtyAccountBindingSnapshot {
  return {
    claudeBindings: state.claudeLivePtyAccountBindings ?? [],
    sharedClaudeIds: state.claudeLivePtySessionIds ?? [],
    sharedClaudeBindings: state.claudeLiveSharedPtyAccountBindings ?? [],
    codexDirectedBindings: state.codexDirectedPtyAccountBindings ?? []
  }
}

export function restorePtyAccountBindings(
  state: StoreOwnedPersistedState,
  snapshot: PtyAccountBindingSnapshot
): void {
  state.claudeLivePtyAccountBindings = snapshot.claudeBindings
  state.claudeLivePtySessionIds = snapshot.sharedClaudeIds
  state.claudeLiveSharedPtyAccountBindings = snapshot.sharedClaudeBindings
  state.codexDirectedPtyAccountBindings = snapshot.codexDirectedBindings
}

// Why one transaction with the pane binding: persistPtyBinding rolls these back with the session on a failed flush.
export function recordPtySpawnAccountBindings(
  state: StoreOwnedPersistedState,
  args: PtySpawnAccountBindingArgs,
  before: PtyAccountBindingSnapshot
): void {
  const validPtyId = args.ptyId.length > 0 && args.ptyId.length <= 512
  const claudeAccountId = args.claudeAccountId
  if (
    validPtyId &&
    typeof claudeAccountId === 'string' &&
    claudeAccountId.length > 0 &&
    claudeAccountId.length <= 512 &&
    !before.claudeBindings.some(
      (entry) => entry.sessionId === args.ptyId && entry.accountId === claudeAccountId
    )
  ) {
    state.claudeLivePtyAccountBindings = [
      ...before.claudeBindings.filter((entry) => entry.sessionId !== args.ptyId),
      { sessionId: args.ptyId, accountId: claudeAccountId }
    ].slice(-MAX_CLAUDE_LIVE_PTY_SESSION_IDS)
  }
  const shouldPersistSharedClaudeBinding =
    Object.hasOwn(args, 'claudeSharedAccountId') &&
    (args.claudeSharedAccountId === null ||
      (typeof args.claudeSharedAccountId === 'string' &&
        args.claudeSharedAccountId.length > 0 &&
        args.claudeSharedAccountId.length <= 512)) &&
    validPtyId
  if (shouldPersistSharedClaudeBinding) {
    state.claudeLivePtySessionIds = (
      before.sharedClaudeIds.includes(args.ptyId)
        ? before.sharedClaudeIds
        : [...before.sharedClaudeIds, args.ptyId]
    ).slice(-MAX_CLAUDE_LIVE_PTY_SESSION_IDS)
    state.claudeLiveSharedPtyAccountBindings = [
      ...before.sharedClaudeBindings.filter((entry) => entry.sessionId !== args.ptyId),
      {
        sessionId: args.ptyId,
        accountId: args.claudeSharedAccountId ?? null,
        // Why: this is the spawning launch recording its own selection, so a null
        // here means "no managed account", not unknown ownership. Without the marker
        // the row reads as a legacy unknown after a restart and locks every account
        // until a probe clears it (ORCA-190).
        accountResolved: true
      }
    ].slice(-MAX_CLAUDE_LIVE_PTY_SESSION_IDS)
  }
  const codexDirectedAccountId = args.codexDirectedAccountId
  if (
    validPtyId &&
    typeof codexDirectedAccountId === 'string' &&
    codexDirectedAccountId.length > 0 &&
    codexDirectedAccountId.length <= 512
  ) {
    state.codexDirectedPtyAccountBindings = [
      ...before.codexDirectedBindings.filter((entry) => entry.sessionId !== args.ptyId),
      { sessionId: args.ptyId, accountId: codexDirectedAccountId }
    ].slice(-MAX_CLAUDE_LIVE_PTY_SESSION_IDS)
  }
}

export function getClaudeLiveSharedPtyAccountBindings(
  state: PersistedState
): ClaudeLiveSharedPtyAccountBinding[] {
  return (state.claudeLiveSharedPtyAccountBindings ?? []).map((binding) => ({ ...binding }))
}

export function getClaudeLivePtyAccountBindings(
  state: PersistedState
): ClaudeLivePtyAccountBinding[] {
  return (state.claudeLivePtyAccountBindings ?? []).map((binding) => ({ ...binding }))
}

export function getCodexDirectedPtyAccountBindings(
  state: PersistedState
): CodexDirectedPtyAccountBinding[] {
  return (state.codexDirectedPtyAccountBindings ?? []).map((binding) => ({ ...binding }))
}

function assertValidPtyAccountBinding(sessionId: string, accountId: string, label: string): void {
  if (
    sessionId.length === 0 ||
    sessionId.length > 512 ||
    accountId.length === 0 ||
    accountId.length > 512
  ) {
    throw new Error(`Invalid ${label} account binding.`)
  }
}

export function addClaudeLivePtyAccountBinding(
  operations: ManagedAccountPtyBindingOperations,
  sessionId: string,
  accountId: string
): void {
  assertValidPtyAccountBinding(sessionId, accountId, 'live Claude PTY')
  const currentBindings = operations.state.claudeLivePtyAccountBindings ?? []
  if (
    currentBindings.some((entry) => entry.sessionId === sessionId && entry.accountId === accountId)
  ) {
    return
  }
  const bindings = currentBindings.filter((entry) => entry.sessionId !== sessionId)
  operations.state.claudeLivePtyAccountBindings = [...bindings, { sessionId, accountId }].slice(
    -MAX_CLAUDE_LIVE_PTY_SESSION_IDS
  )
  // Why: a daemon CLI can outlive a force-quit, so its account ownership must
  // reach disk before spawn returns and any later global switch can occur.
  try {
    operations.flushOrThrow()
  } catch (error) {
    operations.state.claudeLivePtyAccountBindings = currentBindings
    // Why: flushOrThrow cancels the prior debounce before writing. Re-arm it
    // so unrelated state that was pending before this failed binding retries.
    operations.scheduleSave()
    throw error
  }
}

export function removeClaudeLivePtyAccountBinding(
  operations: ManagedAccountPtyBindingOperations,
  sessionId: string
): void {
  const bindings = operations.state.claudeLivePtyAccountBindings ?? []
  if (!bindings.some((entry) => entry.sessionId === sessionId)) {
    return
  }
  operations.state.claudeLivePtyAccountBindings = bindings.filter(
    (entry) => entry.sessionId !== sessionId
  )
  operations.scheduleSave()
}

export function addCodexDirectedPtyAccountBinding(
  operations: ManagedAccountPtyBindingOperations,
  sessionId: string,
  accountId: string
): void {
  assertValidPtyAccountBinding(sessionId, accountId, 'directed Codex PTY')
  const currentBindings = operations.state.codexDirectedPtyAccountBindings ?? []
  if (
    currentBindings.some((entry) => entry.sessionId === sessionId && entry.accountId === accountId)
  ) {
    return
  }
  const bindings = currentBindings.filter((entry) => entry.sessionId !== sessionId)
  operations.state.codexDirectedPtyAccountBindings = [...bindings, { sessionId, accountId }].slice(
    -MAX_CLAUDE_LIVE_PTY_SESSION_IDS
  )
  // Why sync: a daemon Codex CLI can outlive a force-quit, and only this fact
  // tells the next launch to reattach instead of minting an empty session.
  try {
    operations.flushOrThrow()
  } catch (error) {
    operations.state.codexDirectedPtyAccountBindings = currentBindings
    operations.scheduleSave()
    throw error
  }
}

export function removeCodexDirectedPtyAccountBinding(
  operations: ManagedAccountPtyBindingOperations,
  sessionId: string
): void {
  const bindings = operations.state.codexDirectedPtyAccountBindings ?? []
  if (!bindings.some((entry) => entry.sessionId === sessionId)) {
    return
  }
  operations.state.codexDirectedPtyAccountBindings = bindings.filter(
    (entry) => entry.sessionId !== sessionId
  )
  operations.scheduleSave()
}
