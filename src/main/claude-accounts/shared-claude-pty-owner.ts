import { fingerprintClaudeRefreshChain } from './claude-refresh-chain-fingerprint'
import type { LiveProcessEnvironmentValue } from './live-process-environment'

/**
 * Which managed account's single-use OAuth refresh chain a live shared Claude PTY
 * actually owns. `unmanaged` is a positive answer — the process reads a config dir
 * that holds no managed account's chain — and is what lets pinned launches through.
 * `unknown` keeps the conservative every-account block and carries the reason so
 * the refusal message can say why nothing may launch.
 */
export type SharedClaudePtyOwner =
  | { kind: 'managed'; accountId: string }
  | { kind: 'unmanaged' }
  | { kind: 'unknown'; reason: string }

/** A managed account as the owner resolution sees it. `forksOauthChain` is false for
 *  custom-endpoint accounts: they read a static token from their own settings.json, so
 *  they have no single-use chain to compare and none to fork. */
export type SharedClaudePtyOwnerCandidate = {
  id: string
  managedAuthPath: string
  forksOauthChain: boolean
}

export type SharedClaudePtyOwnerProbe = {
  /** null when the process is gone or its environment is unreadable here. */
  readClaudeConfigDirEnv: (pid: number) => Promise<LiveProcessEnvironmentValue | null>
  managedAccounts: () => readonly SharedClaudePtyOwnerCandidate[]
  /** Credentials in the shared runtime config dir; outer null means the read
   *  failed, inner null means the dir holds none. */
  readSharedRuntimeCredentials: () => Promise<{ credentialsJson: string | null } | null>
  readManagedCredentials: (accountId: string) => Promise<string | null>
  platform?: NodeJS.Platform
}

function isSameConfigDir(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/, '')
  return platform === 'win32'
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : normalize(left) === normalize(right)
}

/**
 * Resolves a shared PTY's owner from evidence, never from the current global
 * selection: the config dir its process actually uses, then the refresh chain that
 * dir holds matched against every managed account (ORCA-190).
 *
 * Why an unreadable environment does not dead-end: only Linux exposes another
 * process's environment (`/proc/<pid>/environ`) — macOS hides it from a non-root
 * `ps` and Windows exposes it to nobody, verified 2026-08-05. The caller is always
 * a session id recorded in the SHARED PTY list, which no injected launch writes, so
 * that record — not a guess — says the process reads the shared runtime dir. The
 * environment read is what additionally proves it, where a platform allows it.
 *
 * Every credential read that fails still resolves to `unknown` and keeps blocking.
 */
export async function resolveSharedClaudePtyOwner(
  pid: number | null,
  probe: SharedClaudePtyOwnerProbe
): Promise<SharedClaudePtyOwner> {
  const platform = probe.platform ?? process.platform
  if (pid === null) {
    return { kind: 'unknown', reason: 'its process id is not known' }
  }
  const injectedConfigDir = (await probe.readClaudeConfigDirEnv(pid))?.value?.trim() || null
  if (injectedConfigDir) {
    const account = probe
      .managedAccounts()
      .find((candidate) => isSameConfigDir(candidate.managedAuthPath, injectedConfigDir, platform))
    return account
      ? { kind: 'managed', accountId: account.id }
      : {
          kind: 'unknown',
          reason: `it runs against an unrecognized CLAUDE_CONFIG_DIR (${injectedConfigDir})`
        }
  }
  return resolveOwnerFromSharedRuntimeChain(probe)
}

async function resolveOwnerFromSharedRuntimeChain(
  probe: SharedClaudePtyOwnerProbe
): Promise<SharedClaudePtyOwner> {
  const sharedCredentials = await probe.readSharedRuntimeCredentials()
  if (!sharedCredentials) {
    return { kind: 'unknown', reason: 'the shared runtime credentials could not be read' }
  }
  const sharedFingerprint = sharedCredentials.credentialsJson
    ? fingerprintClaudeRefreshChain(sharedCredentials.credentialsJson)
    : null
  if (!sharedFingerprint) {
    // No OAuth refresh chain in the dir this process reads, so there is none to fork.
    return { kind: 'unmanaged' }
  }
  let hasUncomparableAccount = false
  for (const account of probe.managedAccounts()) {
    // Why skipped rather than counted uncomparable: a custom-endpoint account has no
    // OAuth chain to read, so it can never be this PTY's owner — and letting its
    // unreadable credentials force "unknown" kept the wildcard asserted on a machine
    // that merely had one endpoint account configured (ORCA-190).
    if (!account.forksOauthChain) {
      continue
    }
    const credentialsJson = await probe.readManagedCredentials(account.id)
    const fingerprint = credentialsJson ? fingerprintClaudeRefreshChain(credentialsJson) : null
    if (!fingerprint) {
      hasUncomparableAccount = true
      continue
    }
    if (fingerprint === sharedFingerprint) {
      return { kind: 'managed', accountId: account.id }
    }
  }
  return hasUncomparableAccount
    ? {
        kind: 'unknown',
        reason: 'one managed account credential could not be read for comparison'
      }
    : { kind: 'unmanaged' }
}
