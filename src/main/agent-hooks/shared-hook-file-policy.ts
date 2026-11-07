import type { ManagedHookWritePolicy } from '../claude/managed-hook-placement'

let sharedHookFilePolicy: ManagedHookWritePolicy = 'replace'

/**
 * A dev Orca shares ~/.orca/agent-hooks and ~/.codex/hooks.json with the installed one, which
 * owns them: dev creates a missing script but never rewrites one, and never edits the real
 * Codex hooks (ORCA-1131). E2E runs under a disposable home, so it keeps the packaged behavior.
 */
export function resolveSharedHookFilePolicy(options: {
  isPackaged: boolean
  isE2E: boolean
}): ManagedHookWritePolicy {
  return options.isPackaged || options.isE2E ? 'replace' : 'keep-existing'
}

export function setSharedHookFilePolicy(policy: ManagedHookWritePolicy): void {
  sharedHookFilePolicy = policy
}

export function getSharedHookFilePolicy(): ManagedHookWritePolicy {
  return sharedHookFilePolicy
}
