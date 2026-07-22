import type { TuiAgent } from '../../shared/types'
import type { PtyStartupIngressIntent } from '../../shared/pty-startup-ingress'
import type { StartupCommandDelivery } from '../../shared/codex-startup-delivery'
import type {
  AgentSessionExecutionClaim,
  AgentSessionSurfaceBinding
} from '../../shared/agent-session-host-authority'

// Why: split out of providers/types.ts to keep that module inside the
// max-lines budget; re-exported there so provider consumers are unaffected.
export type PtySpawnOptions = {
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string>
  envToDelete?: string[]
  /** Main-validated home provenance for an automatic Codex session resume. */
  codexHomePathOverride?: { value: string | null }
  command?: string
  commandDelivery?: 'renderer' | 'provider'
  startupCommandDelivery?: StartupCommandDelivery
  /** Minimal allowlisted launch ownership preserved by daemon reattach. */
  launchAgent?: TuiAgent
  /** Orca worktree identity. When present, the local provider scopes shell
   *  history to this worktree so ArrowUp only surfaces local commands. */
  worktreeId?: string
  /** Stable terminal pane identity. Remote providers use this as PTY metadata
   *  even when it must not be exported into the spawned shell environment. */
  paneKey?: string
  /** Stable terminal tab identity used as a coarser attach guard when a pane
   *  identity is unavailable. */
  tabId?: string
  /** Daemon session ID. A caller-provided ID is treated as an attach request;
   *  daemon hosts also pass minted IDs for fresh sessions that need stable
   *  per-PTY state before provider.spawn returns. */
  sessionId?: string
  /** Fail instead of creating a replacement process when sessionId is gone.
   *  Why: preserved auth ownership is only valid for the original live process. */
  requireReattach?: boolean
  /** True when the caller minted this daemon session for a fresh terminal.
   *  Existing-session attach paths must stay false so recovery checks do not
   *  replace the daemon out from under a still-live PTY. */
  isNewSession?: boolean
  /** Why: allows the renderer to request a specific shell for a single new
   *  terminal tab (e.g. "open this tab in WSL" from the "+" submenu) without
   *  changing the user's persistent default shell setting. Only consulted on
   *  Windows; ignored on macOS/Linux where shell selection is not exposed. */
  shellOverride?: string
  /** Preferred WSL distro for generic `wsl.exe` launches. Worktree/session
   *  distro still wins when the cwd already identifies a WSL distro. */
  terminalWindowsWslDistro?: string | null
  /** Why: PowerShell is the top-level shell family in product terms, but on
   *  Windows we may need to choose between inbox Windows PowerShell 5.1 and
   *  pwsh.exe at spawn time. Threading the persisted implementation choice
   *  through spawn options keeps local PTY and daemon PTY semantics aligned
   *  without promoting pwsh into a separate shell family. */
  terminalWindowsPowerShellImplementation?: 'auto' | 'powershell.exe' | 'pwsh.exe'
  /** Fresh-spawn-only source authority installed before any PTY output is released. */
  startupIngress?: PtyStartupIngressIntent
  agentSessionEnsure?: {
    claim: AgentSessionExecutionClaim
    surface: AgentSessionSurfaceBinding
  }
  /** Host-scoped structured-create identity used only for lower-owner replay. */
  agentSessionCreateOperationId?: string
  /** Signals that the native process exists even if later publication fails. */
  onPtySpawnCommitted?: () => void
  /** Cancels only before physical dispatch; operation identity fences later ambiguity. */
  signal?: AbortSignal
}
