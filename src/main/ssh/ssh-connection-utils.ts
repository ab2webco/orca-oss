import type { ConnectConfig } from 'ssh2'
import type { SshTarget, SshConnectionState } from '../../shared/ssh-types'
import type { SshResolvedConfig } from './ssh-config-parser'
import {
  findEncryptedPrivateKeyPath,
  resolveAgentConfigValue,
  resolveAgentSocket,
  resolvePrivateKeys,
  resolveUnencryptedExplicitPrivateKeys
} from './ssh-auth-resolution'
import { configurePrivateKeyAuthentication } from './ssh-private-key-authentication'
import { isOpenSshConfigBackedTarget } from './system-ssh-args'

export { findDefaultKeyFile, resolveAgentSocket } from './ssh-auth-resolution'
export {
  cmdEscape,
  shellEscape,
  wrapRemoteCommandForPosixShell
} from './ssh-remote-command-encoding'

export type SshCredentialKind = 'passphrase' | 'password'

export type SshConnectionCallbacks = {
  onStateChange: (targetId: string, state: SshConnectionState) => void
  onCredentialRequest?: (
    targetId: string,
    kind: SshCredentialKind,
    detail: string
  ) => Promise<string | null>
}

export function isPassphraseError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return msg.includes('passphrase') || msg.includes('encrypted key') || msg.includes('bad decrypt')
}

export const INITIAL_RETRY_ATTEMPTS = 5
export const INITIAL_RETRY_DELAY_MS = 2000
export const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 5000, 10000, 10000, 10000, 30000, 30000]
export const CONNECT_TIMEOUT_MS = 30_000

const TRANSIENT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN'
])

export function isAuthError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return (
    msg.includes('all configured authentication methods failed') ||
    msg.includes('authentication failed') ||
    msg.includes('too many authentication failures') ||
    /permission denied(?:, please try again\.?| \([^)]*(?:publickey|password|keyboard-interactive|gssapi|hostbased)[^)]*\))/.test(
      msg
    ) ||
    (err as { level?: string }).level === 'client-authentication'
  )
}

export function isAgentFallbackError(err: Error): boolean {
  return isAuthError(err) || (err as { level?: string }).level === 'agent'
}

export function isTransientError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true
  }
  if (err.message.includes('ETIMEDOUT')) {
    return true
  }
  if (err.message.includes('ECONNREFUSED')) {
    return true
  }
  if (err.message.includes('ECONNRESET')) {
    return true
  }
  return false
}

const SYSTEM_SSH_FALLBACK_ERROR_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH'])

export function isSystemSshFallbackError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code
  if (code && SYSTEM_SSH_FALLBACK_ERROR_CODES.has(code)) {
    return true
  }
  return err.message.includes('EHOSTUNREACH') || err.message.includes('ENETUNREACH')
}

// Why: ssh2 has no gssapi-with-mic support. When the effective OpenSSH config
// enables GSSAPIAuthentication (often a distro-wide /etc/ssh default), a
// Kerberos ticket can still authenticate through the system ssh binary after
// key/agent auth fails — but only auth-shaped failures qualify, so network
// errors keep their existing retry semantics.
export function isGssapiSystemSshFallbackCandidate(
  err: Error,
  target: Pick<SshTarget, 'gssapiAuthentication'>,
  resolved: Pick<SshResolvedConfig, 'gssapiAuthentication'> | null
): boolean {
  // Why: targets with an explicit per-host flag already tried system ssh
  // proactively during this attempt; probing again cannot succeed.
  if (target.gssapiAuthentication === true) {
    return false
  }
  return (isAuthError(err) || isPassphraseError(err)) && resolved?.gssapiAuthentication === true
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type SshExecOptions = {
  wrapCommand?: boolean
  signal?: AbortSignal
}

export function createSshOperationAbortError(): Error & { name: string } {
  const error = new Error('SSH operation was cancelled') as Error & {
    name: string
  }
  error.name = 'AbortError'
  return error
}

type BuildConnectConfigOptions = {
  includeAgent?: boolean
  includePrivateKey?: boolean
}

// Why: ssh2 tries privateKey before agent, but parses encrypted privateKey
// values before any agent auth can run. Keep unencrypted explicit keys first
// while deferring encrypted keys until the post-agent passphrase path.
export function buildConnectConfig(
  target: SshTarget,
  resolved: SshResolvedConfig | null,
  options: BuildConnectConfigOptions = {}
): ConnectConfig {
  const effectiveHost = resolveEffectiveHost(target, resolved)
  const effectivePort = resolveEffectivePort(target, resolved)
  const effectiveUser =
    isOpenSshConfigBackedTarget(target) && resolved
      ? (resolved.user ?? target.username)
      : target.username || resolved?.user || ''

  const config: Record<string, unknown> = {
    host: effectiveHost,
    port: effectivePort,
    username: effectiveUser,
    readyTimeout: CONNECT_TIMEOUT_MS,
    keepaliveInterval: 15_000
  }

  const shouldIncludeAgent = options.includeAgent ?? true
  const agentSocket = shouldIncludeAgent ? resolveAgentSocket(target, resolved) : undefined
  const agent = agentSocket ? resolveAgentConfigValue(agentSocket, target, resolved) : undefined

  if (agent) {
    config.agent = agent
  }

  if (agent && resolved?.forwardAgent) {
    config.agentForward = true
  }

  const keys =
    (options.includePrivateKey ?? !agent)
      ? resolvePrivateKeys(target, resolved)
      : resolveUnencryptedExplicitPrivateKeys(target, resolved)
  configurePrivateKeyAuthentication(
    config as ConnectConfig,
    keys,
    findEncryptedPrivateKeyPath(keys)
  )

  return config as ConnectConfig
}

function resolveEffectiveHost(target: SshTarget, resolved: SshResolvedConfig | null): string {
  if (isOpenSshConfigBackedTarget(target) && resolved?.hostname) {
    return resolved.hostname
  }
  if (shouldUseResolvedEndpoint(target, resolved)) {
    return resolved!.hostname
  }
  return target.host || resolved?.hostname || target.label
}

function resolveEffectivePort(target: SshTarget, resolved: SshResolvedConfig | null): number {
  if (isOpenSshConfigBackedTarget(target) && resolved) {
    return resolved.port || target.port || 22
  }
  // Why: imported config aliases store 22 as the schema default even when an
  // included/wildcard OpenSSH rule later resolves a different effective Port.
  if (target.configHost && target.port === 22 && resolved?.port) {
    return resolved.port
  }
  return target.port || resolved?.port || 22
}

function shouldUseResolvedEndpoint(target: SshTarget, resolved: SshResolvedConfig | null): boolean {
  if (!target.configHost || !resolved?.hostname) {
    return false
  }
  const host = target.host.trim()
  return host === '' || host === target.configHost || host === target.label
}
