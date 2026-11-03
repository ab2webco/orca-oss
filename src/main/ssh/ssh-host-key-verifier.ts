/** Host key policy for ssh2 connections; the system OpenSSH transport verifies keys itself. */
import { createHash } from 'node:crypto'
import {
  matchKnownHosts,
  readHostKeyType,
  type KnownHostsEntry,
  type KnownHostsOutcome
} from './ssh-known-hosts'

type HostKeyAction = 'accept' | 'accept-and-remember' | 'reject'

export type HostKeyDecision = {
  action: HostKeyAction
  outcome: KnownHostsOutcome
  reason?: string
}

type HostKeyDecisionInput = {
  knownHostsOutcome: KnownHostsOutcome
  storeOutcome: KnownHostsOutcome
  /** Effective StrictHostKeyChecking as `ssh -G` prints it (yes→true, no→false). */
  strictHostKeyChecking: string
  /** On-demand VMs present a new key every launch; recording them only breeds false alarms. */
  ephemeral: boolean
  /** An existing but unreadable known_hosts may hide a mismatch, so nothing is recorded from it. */
  knownHostsUnreadable: boolean
  displayHost: string
  port: number
}

const STRICT_VALUES = new Set(['true', 'yes', 'always'])
const LAX_VALUES = new Set(['false', 'no', 'off'])

/** Typed so the connect path can stop before any credential is offered to the refused host. */
export class HostKeyVerificationError extends Error {
  constructor(
    message: string,
    readonly outcome: KnownHostsOutcome
  ) {
    super(message)
    this.name = 'HostKeyVerificationError'
  }
}

export function isHostKeyVerificationError(err: unknown): err is HostKeyVerificationError {
  return err instanceof HostKeyVerificationError
}

// Never phrase a refusal as an auth failure: the reconnect ladder retries those.
function reject(input: HostKeyDecisionInput, outcome: KnownHostsOutcome, detail: string) {
  const reason = `Host key verification failed for ${input.displayHost}. ${detail}`
  return { action: 'reject' as const, outcome, reason }
}

function keygenRemedy({ displayHost, port }: HostKeyDecisionInput): string {
  const target = port === 22 ? displayHost : `'[${displayHost}]:${port}'`
  return `ssh and git will refuse this host too. If it was rebuilt, run: ssh-keygen -R ${target}`
}

const STORE_REMEDY =
  "If it was rebuilt, remove its line from ssh/known_hosts in Orca's data folder and reconnect."

export function decideHostKey(input: HostKeyDecisionInput): HostKeyDecision {
  const { knownHostsOutcome, storeOutcome } = input
  const strict = input.strictHostKeyChecking.toLowerCase()
  if (knownHostsOutcome === 'revoked') {
    return reject(input, 'revoked', 'This host key has been revoked.')
  }
  if (knownHostsOutcome === 'mismatch') {
    return reject(
      input,
      'mismatch',
      `The key does not match your known_hosts. ${keygenRemedy(input)}`
    )
  }
  // known_hosts is the authority ssh obeys, so it wins over a stale Orca record.
  if (knownHostsOutcome === 'match' || storeOutcome === 'match') {
    return { action: 'accept', outcome: 'match' }
  }
  if (storeOutcome === 'mismatch') {
    return reject(input, 'mismatch', `The key changed since Orca last connected. ${STORE_REMEDY}`)
  }
  // A known host offering a type we hold no key for is a downgrade attempt, not first contact.
  const fromKnownHosts = knownHostsOutcome === 'unknown-type-known-host'
  if (fromKnownHosts || storeOutcome === 'unknown-type-known-host') {
    return reject(
      input,
      'unknown-type-known-host',
      `The host offered a key type not seen for it before while another type is known. ${
        fromKnownHosts ? keygenRemedy(input) : STORE_REMEDY
      }`
    )
  }
  const outcome = knownHostsOutcome === 'ca-only' ? 'ca-only' : 'unknown'
  if (STRICT_VALUES.has(strict)) {
    return reject(input, outcome, 'The host is not in known_hosts and StrictHostKeyChecking is on.')
  }
  if (input.ephemeral || input.knownHostsUnreadable || LAX_VALUES.has(strict)) {
    return { action: 'accept', outcome }
  }
  // accept-new semantics: first contact is recorded in Orca's own store, never in known_hosts.
  return { action: 'accept-and-remember', outcome }
}

export function hostKeyFingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export type HostKeyVerifierDeps = Omit<
  HostKeyDecisionInput,
  'knownHostsOutcome' | 'storeOutcome' | 'displayHost'
> & {
  host: string
  isHostKeyAlias?: boolean
  knownHosts: readonly KnownHostsEntry[]
  orcaStore: readonly KnownHostsEntry[]
  rememberHostKey: (record: { host: string; port: number; keyType: string; key: Buffer }) => void
  onDecision?: (decision: HostKeyDecision & { fingerprint?: string }) => void
}

type VerifyCallback = (accept: boolean) => void

/** Must stay synchronous and return undefined: ssh2 accepts any other return value, a Promise included. */
export function createHostKeyVerifier(
  deps: HostKeyVerifierDeps
): (key: Buffer, verify: VerifyCallback) => undefined {
  const deny = (verify: VerifyCallback, detail: string): undefined => {
    const reason = `Host key verification failed for ${deps.host}. ${detail}`
    try {
      deps.onDecision?.({ action: 'reject', outcome: 'unknown', reason })
    } finally {
      verify(false)
    }
    return undefined
  }
  return (key, verify) => {
    let decision: HostKeyDecision
    let fingerprint: string
    try {
      const keyType = readHostKeyType(key)
      if (!keyType) {
        return deny(verify, 'The host offered a key that could not be read.')
      }
      const query = { host: deps.host, port: deps.port, keyType, key }
      const lookup = { ...query, isHostKeyAlias: deps.isHostKeyAlias }
      decision = decideHostKey({
        ...deps,
        knownHostsOutcome: matchKnownHosts(deps.knownHosts, lookup),
        storeOutcome: matchKnownHosts(deps.orcaStore, lookup),
        displayHost: deps.host
      })
      fingerprint = hostKeyFingerprintOf(key)
      if (decision.action === 'accept-and-remember') {
        deps.rememberHostKey(query)
      }
    } catch {
      // A throw inside ssh2's verifier can hang the handshake instead of failing it.
      return deny(verify, 'The host key could not be checked.')
    }
    deps.onDecision?.({ ...decision, fingerprint })
    verify(decision.action !== 'reject')
    return undefined
  }
}

/** RFC 4253 lets the client order decide; leading with known types stops a type-swap downgrade. */
export function orderServerHostKeyAlgorithms(
  entries: readonly KnownHostsEntry[],
  host: string,
  port: number,
  supported: readonly string[],
  isHostKeyAlias = false
): string[] | undefined {
  const known = new Set<string>()
  for (const entry of entries) {
    const query = {
      host,
      port,
      keyType: entry.keyType,
      key: entry.key,
      isHostKeyAlias
    }
    if (entry.marker !== 'revoked' && matchKnownHosts([entry], query) === 'match') {
      known.add(entry.keyType)
    }
  }
  // One ssh-rsa key is negotiated under every rsa-sha2-* signature name.
  const preferred = supported.filter(
    (algorithm) =>
      known.has(algorithm) || (known.has('ssh-rsa') && algorithm.startsWith('rsa-sha2-'))
  )
  if (preferred.length === 0) {
    return undefined
  }
  return [...preferred, ...supported.filter((algorithm) => !preferred.includes(algorithm))]
}
