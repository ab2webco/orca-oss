import type { StartupCommandDelivery } from '../../shared/codex-startup-delivery'
import type { TuiAgent } from '../../shared/types'
import type { SubprocessHandle } from './session'
import type { TakePendingOutputResult, TerminalSnapshot } from './types'

export type TerminalHostOptions = {
  spawnSubprocess: (opts: {
    sessionId: string
    cols: number
    rows: number
    cwd?: string
    env?: Record<string, string>
    envToDelete?: string[]
    command?: string
    startupCommandDelivery?: StartupCommandDelivery
    launchAgent?: TuiAgent
    shellOverride?: string
    terminalWindowsWslDistro?: string | null
    terminalWindowsPowerShellImplementation?: 'auto' | 'powershell.exe' | 'pwsh.exe'
  }) => SubprocessHandle
  // Why: login-session death detection (#7936) needs subprocess exits even when no client is attached.
  onSessionReaped?: (sessionId: string) => void
  // Why: a launch command still withheld at the shell-ready budget is the one
  // failure a pane cannot show — it stays titled and connected with no agent in
  // it, so the fact has to leave the daemon on its own (ORCA-210).
  onStartupCommandStateChange?: (sessionId: string, state: 'withheld' | 'delivered') => void
  // Why: graceful shutdown checkpoints must finish in-process before teardown.
  onFinalCheckpoint?: (
    sessionId: string,
    snapshot: TerminalSnapshot,
    records: TakePendingOutputResult['records']
  ) => void
  // Why: tests need deterministic tombstone eviction without thousands of sessions.
  maxTombstones?: number
}
