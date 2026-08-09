import type { ClaudeTerminalSwitchReadiness } from '../../shared/claude-terminal-account-switch'
import type {
  ClaudeTerminalAccountOwnership,
  ClaudeTerminalAccountReport
} from '../../shared/types'

/**
 * The live-pty gate's view of one PTY, read through an interface so the
 * three-state resolution is exercised without the module-level gate maps.
 */
export type ClaudePtyAccountBindingReader = {
  /** Account of a pinned per-worktree universe, written by `markInjectedClaudePtySpawned`. */
  getInjectedAccountId(ptyId: string): string | null
  isSharedPty(ptyId: string): boolean
  isUnknownOwnerSharedPty(ptyId: string): boolean
  getSharedAccountId(ptyId: string): string | null
  findAccountEmail(accountId: string): string | null
}

/**
 * Resolves which managed Claude account a PTY runs on. Never falls back to the
 * global selection: that fallback is the ORCA-175 defect.
 */
export function resolveClaudePtyAccountOwnership(
  ptyId: string,
  reader: ClaudePtyAccountBindingReader
): ClaudeTerminalAccountOwnership {
  const injectedAccountId = reader.getInjectedAccountId(ptyId)
  if (injectedAccountId) {
    return account(injectedAccountId, true, reader)
  }
  if (!reader.isSharedPty(ptyId)) {
    return { state: 'unknown', reason: 'no-claude-binding' }
  }
  // Why unknown and not none: a shared PTY seeded from a pre-binding persistence
  // row records no owner, which ORCA-190 keeps distinct from a launch that
  // genuinely ran against the user's own login.
  if (reader.isUnknownOwnerSharedPty(ptyId)) {
    return { state: 'unknown', reason: 'ownership-unresolved' }
  }
  const sharedAccountId = reader.getSharedAccountId(ptyId)
  return sharedAccountId ? account(sharedAccountId, false, reader) : { state: 'none' }
}

/** The pane a terminal handle resolved to; `null` when no record matched at all. */
export type ClaudeTerminalPane = {
  ptyId: string
  /** A dead record still answers; its absent binding proves nothing (ORCA-186). */
  connected: boolean
  /** WSL distro or SSH host — the Claude there authenticates on that host. */
  remote: boolean
}

/** Full per-terminal answer: pane resolution plus the gate's binding. */
export function resolveClaudeTerminalAccountReport(args: {
  terminal: string
  pane: ClaudeTerminalPane | null
  reader: ClaudePtyAccountBindingReader
  /** Decided by the switch's own preflight; this module never re-derives it. */
  switchReadiness?: ClaudeTerminalSwitchReadiness
}): ClaudeTerminalAccountReport {
  const readiness = args.switchReadiness ? { switchReadiness: args.switchReadiness } : {}
  if (!args.pane?.connected) {
    return {
      terminal: args.terminal,
      ptyId: args.pane?.ptyId ?? null,
      ownership: { state: 'unknown', reason: 'pane-unresolved' },
      ...readiness
    }
  }
  const ownership = resolveClaudePtyAccountOwnership(args.pane.ptyId, args.reader)
  // Why the remote check lands after the binding: a pinned WSL pane has a real
  // binding to report. Only an unbound remote pane is unknowable from here.
  const remoteUnknown = args.pane.remote && ownership.state !== 'account'
  return {
    terminal: args.terminal,
    ptyId: args.pane.ptyId,
    ownership: remoteUnknown ? { state: 'unknown', reason: 'remote-host' } : ownership,
    ...readiness
  }
}

// A removed account keeps its id and reports no email; substituting any other
// account's label is how the wrong identity gets reported as this pane's.
function account(
  accountId: string,
  pinned: boolean,
  reader: ClaudePtyAccountBindingReader
): ClaudeTerminalAccountOwnership {
  return { state: 'account', accountId, email: reader.findAccountEmail(accountId), pinned }
}
