import { RuntimeClientError, type RuntimeClient } from './runtime-client'
import { getPresentStringFlag } from './flags'

/**
 * Identity of the terminal a CLI command was invoked from, proven rather than
 * claimed. `paneKey` + `launchToken` are minted per launch and handed only to
 * that pane's child process, so the runtime can re-derive the handle itself and
 * survive a handle remint.
 */
export type CallerTerminalIdentity = {
  terminal: string
  paneKey?: string
  launchToken?: string
}

function getClientErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isStaleTerminalIdentity(error: unknown): boolean {
  const code = getClientErrorCode(error)
  return (
    code === 'terminal_handle_stale' || code === 'terminal_gone' || code === 'terminal_not_found'
  )
}

async function isLiveTerminalHandle(handle: string, client: RuntimeClient): Promise<boolean> {
  try {
    // Why terminal.show: it reads the pane summary without focusing or creating
    // anything, so probing liveness cannot move the user's view.
    await client.call('terminal.show', { terminal: handle })
    return true
  } catch (error) {
    if (isStaleTerminalIdentity(error)) {
      return false
    }
    throw error
  }
}

async function remintFromPaneKey(paneKey: string, client: RuntimeClient): Promise<string | null> {
  try {
    const response = await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey
    })
    return response.result.terminal.handle
  } catch (error) {
    if (isStaleTerminalIdentity(error) || getClientErrorCode(error) === 'runtime_unavailable') {
      return null
    }
    throw error
  }
}

function throwNoCallerTerminal(flagName: string): never {
  throw new RuntimeClientError(
    'no_caller_terminal',
    `Could not determine which terminal to act on. Pass --${flagName} <terminal-handle>, or run this ` +
      'command inside a live Orca terminal (ORCA_TERMINAL_HANDLE / ORCA_PANE_KEY are exported there).'
  )
}

/**
 * Resolves the terminal a command targets: explicit flag, then the caller's own
 * proven pane.
 *
 * There is deliberately NO focused/active-terminal fallback. A destructive
 * per-terminal operation must land on the pane the caller can prove it owns —
 * guessing from focus would stop somebody else's agent.
 */
export async function resolveCallerTerminalIdentity(args: {
  flags: Map<string, string | boolean>
  client: RuntimeClient
  /** Flag that names the terminal explicitly; used in error text too. */
  flagName?: string
  env?: NodeJS.ProcessEnv
}): Promise<CallerTerminalIdentity> {
  const flagName = args.flagName ?? 'terminal'
  const env = args.env ?? process.env
  const paneKey = env.ORCA_PANE_KEY || undefined
  const launchToken = env.ORCA_AGENT_LAUNCH_TOKEN || undefined
  const proof = {
    ...(paneKey ? { paneKey } : {}),
    ...(launchToken ? { launchToken } : {})
  }

  const explicit = getPresentStringFlag(args.flags, flagName)
  if (explicit !== undefined) {
    const trimmed = explicit.trim()
    if (trimmed.length === 0) {
      throw new RuntimeClientError('invalid_argument', `Missing value for --${flagName}`)
    }
    return { terminal: trimmed, ...proof }
  }

  const envHandle = env.ORCA_TERMINAL_HANDLE?.trim()
  if (envHandle) {
    // Why validate: a long-lived shell keeps its original ORCA_TERMINAL_HANDLE
    // across a remint, and the stale handle can point at a different pane.
    if (await isLiveTerminalHandle(envHandle, args.client)) {
      return { terminal: envHandle, ...proof }
    }
  }
  if (paneKey) {
    const reminted = await remintFromPaneKey(paneKey, args.client)
    if (reminted) {
      return { terminal: reminted, ...proof }
    }
  }
  throwNoCallerTerminal(flagName)
}
