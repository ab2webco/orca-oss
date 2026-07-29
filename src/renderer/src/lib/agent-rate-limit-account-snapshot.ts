import type { AutoSwitchRateLimitAgent } from '../../../shared/agent-rate-limit-detection'
import type { ManagedPtyAccountOwner } from '../../../shared/types'
import { useAppStore } from '@/store'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type {
  AutoSwitchAccountCandidate,
  AutoSwitchAccountsSnapshot
} from './agent-rate-limit-auto-switch'

export type AccountsSnapshotResult = {
  accounts: AutoSwitchAccountsSnapshot
  target: RuntimeClientTarget
  quotaRefreshStartedAt: number
}

/** Refreshes local inactive-account quota data before selecting an auto-switch target. */
async function loadLocalAccountsSnapshot(
  agent: AutoSwitchRateLimitAgent
): Promise<AccountsSnapshotResult> {
  const quotaRefreshStartedAt = Date.now()
  const fetchInactive =
    agent === 'claude'
      ? window.api.rateLimits.fetchInactiveClaudeAccounts
      : window.api.rateLimits.fetchInactiveCodexAccounts
  await Promise.all([fetchInactive(), window.api.rateLimits.refresh()])
  const [claude, codex, rateLimits] = await Promise.all([
    window.api.claudeAccounts.list(),
    window.api.codexAccounts.list(),
    window.api.rateLimits.get()
  ])
  useAppStore.getState().setRateLimitsFromPush(rateLimits)
  return {
    accounts: { claude, codex, rateLimits },
    target: { kind: 'local' },
    quotaRefreshStartedAt
  }
}

/** Resolves PTY ownership from the runtime that created the managed shell. */
export async function loadManagedPtyAccountOwner(args: {
  agent: AutoSwitchRateLimitAgent
  ptyId: string
  snapshot: AccountsSnapshotResult
}): Promise<ManagedPtyAccountOwner> {
  if (args.snapshot.target.kind === 'environment') {
    return callRuntimeRpc<ManagedPtyAccountOwner>(
      args.snapshot.target,
      'accounts.getPtyOwner',
      { ptyId: args.ptyId, agent: args.agent },
      { timeoutMs: 10_000 }
    )
  }
  if (args.agent === 'codex') {
    return window.api.codexAccounts.getLivePtyAccount({ ptyId: args.ptyId })
  }
  const info = await window.api.claudeAccounts.getLivePtyAccount({ ptyId: args.ptyId })
  if (!info) {
    return { known: false, accountId: null, customEndpoint: false }
  }
  const account = info.accountId
    ? args.snapshot.accounts.claude.accounts.find((candidate) => candidate.id === info.accountId)
    : null
  return {
    known: true,
    accountId: info.accountId,
    customEndpoint: account?.authMethod === 'custom-endpoint'
  }
}

/** Loads managed-account and quota state from the PTY-owning runtime. */
export async function loadAccountsSnapshot(args: {
  agent: AutoSwitchRateLimitAgent
  ptyId: string
}): Promise<AccountsSnapshotResult> {
  const environmentId = getRemoteRuntimePtyEnvironmentId(args.ptyId)
  if (!environmentId) {
    return loadLocalAccountsSnapshot(args.agent)
  }
  const target = { kind: 'environment', environmentId } as const
  const quotaRefreshStartedAt = Date.now()
  const accounts = await callRuntimeRpc<AutoSwitchAccountsSnapshot>(
    target,
    'accounts.list',
    undefined,
    { timeoutMs: 30_000 }
  )
  return { accounts, target, quotaRefreshStartedAt }
}

/** Selects the chosen managed account in the same runtime where the PTY is running. */
export async function selectAccount(args: {
  agent: AutoSwitchRateLimitAgent
  runtimeTarget: RuntimeClientTarget
  candidate: AutoSwitchAccountCandidate
}): Promise<void> {
  if (args.runtimeTarget.kind === 'environment') {
    await callRuntimeRpc(
      args.runtimeTarget,
      args.agent === 'claude' ? 'accounts.selectClaude' : 'accounts.selectCodex',
      { accountId: args.candidate.accountId },
      { timeoutMs: 30_000 }
    )
    return
  }

  const selection = {
    accountId: args.candidate.accountId,
    runtime: args.candidate.target.runtime,
    wslDistro: args.candidate.target.wslDistro
  }
  const selectManagedAccount =
    args.agent === 'claude' ? window.api.claudeAccounts.select : window.api.codexAccounts.select
  await selectManagedAccount(selection)
  await useAppStore.getState().fetchSettings()
}
