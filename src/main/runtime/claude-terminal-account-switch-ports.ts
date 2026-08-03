import type { ClaudeManagedAccount } from '../../shared/types'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/runtime-selection'
import { resolveStartupShell } from '../../shared/tui-agent-startup-shell'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import { resolveLocalWindowsAgentStartupShell } from '../../shared/windows-terminal-shell'
import type { ClaudeTerminalAccountSwitchState } from '../../shared/claude-terminal-account-switch'
import type {
  AtomicClaudeTerminalAccountSwitchPorts,
  ClaudeTerminalSwitchCapture
} from '../claude-accounts/atomic-terminal-account-switch'
import {
  abortInPlaceClaudeAccountSwitch,
  beginInPlaceClaudeAccountSwitch,
  finishInPlaceClaudeAccountSwitch
} from '../claude-accounts/in-place-account-switch'
import {
  getLiveInjectedClaudePtyAccountId,
  markInjectedClaudeCliExited,
  markInjectedClaudePtySpawned,
  releaseInjectedClaudeAccountLaunch
} from '../claude-accounts/live-pty-gate'
import { copyClaudeSessionForAccountSwitch } from '../claude-accounts/session-failover'
import { claudeUniverseReportsResumedSession } from '../claude-accounts/claude-resume-observability'
import { resolveOwnedClaudeManagedAuthPath } from '../claude-accounts/managed-auth-path'
import { isManagedClaudeVaultAuthenticated } from '../claude-accounts/managed-vault-authentication'
import { ClaudeRuntimePathResolver } from '../claude-accounts/runtime-paths'
import { getSharedClaudeTranscriptsRoot } from '../claude-accounts/shared-transcript-store'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import {
  awaitClaudeTerminalSourceForeground,
  stopClaudeTerminalForegroundAgent
} from './claude-terminal-foreground-control'
import type { OrcaRuntimeService } from './orca-runtime'

const SESSION_OBSERVATION_TIMEOUT_MS = 90_000
const SESSION_OBSERVATION_POLL_MS = 400

export type ClaudeTerminalAccountSwitchServices = {
  getSettings(): {
    claudeManagedAccounts: readonly ClaudeManagedAccount[]
    terminalWindowsShell?: string | null
  }
  prepareClaudeAuth(
    target?: ClaudeAccountSelectionTarget,
    options?: { reattachLiveInjectedPtyId?: string }
  ): Promise<ClaudeRuntimeAuthPreparation>
  /** Managed-account owner of a live PTY; defaults to the injected-binding registry. */
  getPtyClaudeAccountId?(ptyId: string): string | null
}

export function resolvePtyClaudeAccountId(
  attached: ClaudeTerminalAccountSwitchServices,
  ptyId: string
): string | null {
  return attached.getPtyClaudeAccountId?.(ptyId) ?? getLiveInjectedClaudePtyAccountId(ptyId)
}

export function resolveClaudeTerminalSwitchShell(args: {
  isWsl: boolean
  terminalWindowsShell?: string | null
}): AgentStartupShell {
  if (args.isWsl) {
    return 'posix'
  }
  return (
    resolveLocalWindowsAgentStartupShell({
      platform: process.platform,
      isRemote: false,
      terminalWindowsShell: args.terminalWindowsShell ?? undefined
    }) ?? resolveStartupShell(process.platform)
  )
}

/**
 * Binds the transaction's effects to this runtime's PTY, vault and hook state.
 * Ordering and compensation live in the state machine; nothing here decides
 * whether a switch may proceed.
 */
export function buildClaudeTerminalAccountSwitchPorts(
  runtime: OrcaRuntimeService,
  attached: ClaudeTerminalAccountSwitchServices,
  capture: ClaudeTerminalSwitchCapture,
  onState: (state: ClaudeTerminalAccountSwitchState) => void
): AtomicClaudeTerminalAccountSwitchPorts {
  const getCurrentAccountId = (ptyId: string): string | null =>
    attached.getPtyClaudeAccountId?.(ptyId) ?? getLiveInjectedClaudePtyAccountId(ptyId)
  const selectionTarget = (accountId: string): ClaudeAccountSelectionTarget => ({
    runtime: capture.runtime,
    wslDistro: capture.wslDistro,
    overrideAccountId: accountId
  })

  return {
    now: () => Date.now(),
    capture: async () => ({ ok: true, capture }),
    validateTarget: async () => {
      const account = attached
        .getSettings()
        .claudeManagedAccounts.find((candidate) => candidate.id === capture.targetAccountId)
      if (!account) {
        return { ok: false, reason: 'target-not-found' }
      }
      if (account.authMethod === 'custom-endpoint') {
        return { ok: false, reason: 'target-unsupported-auth' }
      }
      // Why: WSL vaults live on another filesystem and the transcript copy would
      // resolve host paths; reject instead of crossing the boundary.
      if (account.managedAuthRuntime === 'wsl' || capture.runtime === 'wsl') {
        return { ok: false, reason: 'unsupported-runtime' }
      }
      return (await isManagedClaudeVaultAuthenticated(account))
        ? { ok: true, label: account.email }
        : { ok: false, reason: 'target-auth-invalid' }
    },
    prepareTranscript: async () => {
      const copied = copyClaudeSessionForAccountSwitch(
        {
          sessionId: capture.sessionId,
          cwd: capture.cwd,
          targetAccountId: capture.targetAccountId,
          sourceAccountId: capture.sourceAccountId
        },
        {
          getAccounts: () => attached.getSettings().claudeManagedAccounts,
          getSharedConfigDir: () => new ClaudeRuntimePathResolver().getRuntimePaths().configDir,
          getSharedTranscriptsRoot: getSharedClaudeTranscriptsRoot
        }
      )
      return copied.ok
        ? { ok: true, copiedFileCount: copied.copiedFileCount }
        : { ok: false, reason: 'transcript-unavailable' }
    },
    verifyResumeObservability: async ({ configDir }) => {
      const universe =
        configDir ??
        (() => {
          const account = attached
            .getSettings()
            .claudeManagedAccounts.find((candidate) => candidate.id === capture.sourceAccountId)
          return account
            ? resolveOwnedClaudeManagedAuthPath(account.id, account.managedAuthPath)
            : null
        })()
      // Why not a refusal: an unpinned source runs in the shared universe, whose
      // instrumentation the app owns and repairs on every launch.
      return universe === null ? true : claudeUniverseReportsResumedSession(universe)
    },
    awaitSourceForeground: () => awaitClaudeTerminalSourceForeground(runtime, capture),
    stopSource: () => stopClaudeTerminalForegroundAgent(runtime, capture),
    begin: async () => {
      const begun = await beginInPlaceClaudeAccountSwitch(
        {
          ptyId: capture.ptyId,
          sourceAccountId: capture.sourceAccountId,
          targetAccountId: capture.targetAccountId,
          runtime: capture.runtime,
          wslDistro: capture.wslDistro
        },
        {
          getCurrentAccountId,
          getAccountRuntime: (accountId) => {
            const account = attached
              .getSettings()
              .claudeManagedAccounts.find((candidate) => candidate.id === accountId)
            return account
              ? {
                  runtime: account.managedAuthRuntime === 'wsl' ? 'wsl' : 'host',
                  wslDistro: account.wslDistro ?? null
                }
              : null
          },
          inspectProcess: async () => runtime.inspectTerminalProcess(capture.terminal),
          prepareTarget: () => attached.prepareClaudeAuth(selectionTarget(capture.targetAccountId)),
          releaseCurrentBinding: markInjectedClaudeCliExited,
          releaseReservation: releaseInjectedClaudeAccountLaunch
        }
      )
      if (begun.ok) {
        return {
          ok: true,
          configDir: begun.configDir,
          reservationId: begun.reservationId,
          shell: begun.shell
        }
      }
      return {
        ok: false,
        reason:
          begun.reason === 'concurrent'
            ? 'concurrent'
            : begun.reason === 'source-mismatch'
              ? 'source-mismatch'
              : begun.reason === 'runtime-mismatch'
                ? 'unsupported-runtime'
                : begun.reason === 'unhealthy'
                  ? 'source-stop-failed'
                  : 'prepare-failed'
      }
    },
    writeLaunchCommand: async ({ command }) => {
      try {
        const sent = await runtime.sendTerminal(capture.terminal, { text: command, enter: true })
        return sent.accepted
      } catch {
        return false
      }
    },
    awaitExactSession: async ({ observedAfter }) => {
      const deadline = Date.now() + SESSION_OBSERVATION_TIMEOUT_MS
      let observedSessionId: string | undefined
      for (;;) {
        // Why the identity read: a resumed Claude is idle until the continuation
        // prompt lands, and the live-agent snapshot deliberately hides the row
        // that says so — waiting for it there can only time out (ORCA-168).
        const observed = runtime.getExactWorkerProviderSessionIdentity(
          capture.terminal,
          observedAfter
        )
        if (observed?.agent === 'claude' && observed.providerSession?.id) {
          if (observed.providerSession.id === capture.sessionId) {
            return { ok: true }
          }
          observedSessionId = observed.providerSession.id
          return { ok: false, reason: 'session-mismatch', observedSessionId }
        }
        if (Date.now() >= deadline) {
          return {
            ok: false,
            reason: 'foreground-timeout',
            ...(observedSessionId ? { observedSessionId } : {})
          }
        }
        await new Promise((resolve) => setTimeout(resolve, SESSION_OBSERVATION_POLL_MS))
      }
    },
    commit: async ({ reservationId }) => {
      try {
        markInjectedClaudePtySpawned(capture.ptyId, capture.targetAccountId, reservationId)
        return true
      } catch {
        return false
      } finally {
        finishInPlaceClaudeAccountSwitch(capture.ptyId, reservationId)
      }
    },
    stopDestination: async () =>
      stopClaudeTerminalForegroundAgent(runtime, capture).catch(() => false),
    abort: async ({ reservationId }) => {
      const aborted = await abortInPlaceClaudeAccountSwitch(
        {
          ptyId: capture.ptyId,
          sourceAccountId: capture.sourceAccountId,
          reservationId
        },
        {
          getCurrentAccountId,
          prepareSource: () => attached.prepareClaudeAuth(selectionTarget(capture.sourceAccountId)),
          restoreBinding: markInjectedClaudePtySpawned,
          releaseReservation: releaseInjectedClaudeAccountLaunch
        }
      ).catch(() => ({ ok: false }) as const)
      return aborted.ok ? { ok: true, configDir: aborted.configDir } : { ok: false }
    },
    deliverContinuation: async ({ prompt }) => {
      try {
        const sent = await runtime.sendTerminalAgentPrompt(capture.terminal, prompt)
        return sent.accepted
      } catch {
        return false
      }
    },
    onState: ({ state }) => {
      onState(state)
    }
  }
}
