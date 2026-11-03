import type { ConnectConfig } from 'ssh2'
import type { SshTarget } from '../../shared/ssh-types'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import type { SshResolvedConfig } from './ssh-config-parser'
import { loadHostKeyTrustSources, rememberHostKey } from './ssh-host-key-trust-sources'
import {
  createHostKeyVerifier,
  HostKeyVerificationError,
  isHostKeyCheckingOff,
  orderServerHostKeyAlgorithms
} from './ssh-host-key-verifier'

/** Bounds pre-handshake reads of known_hosts on slow network home directories. */
const TRUST_SOURCE_READ_TIMEOUT_MS = 5_000

let ssh2DefaultHostKeyAlgorithms: string[] | null | undefined

/** Reads ssh2's own list so the reorder never proposes an algorithm this build lacks. */
function readSsh2DefaultHostKeyAlgorithms(): string[] | null {
  if (ssh2DefaultHostKeyAlgorithms === undefined) {
    try {
      const list = (
        require('ssh2/lib/protocol/constants.js') as {
          DEFAULT_SERVER_HOST_KEY?: unknown
        }
      ).DEFAULT_SERVER_HOST_KEY
      ssh2DefaultHostKeyAlgorithms =
        Array.isArray(list) && list.every((name) => typeof name === 'string') ? [...list] : null
    } catch {
      ssh2DefaultHostKeyAlgorithms = null
    }
  }
  return ssh2DefaultHostKeyAlgorithms
}

/** Holds the refusal this attempt's verifier made, so the caller can surface it instead of ssh2's generic error. */
export type Ssh2HostKeyVerdict = { rejection: HostKeyVerificationError | null }

export async function installSsh2HostKeyVerification(
  config: ConnectConfig,
  options: {
    target: SshTarget
    resolved: SshResolvedConfig | null
    isCurrentAttempt: () => boolean
    onAcceptedFingerprint: (fingerprint: string) => void
  }
): Promise<Ssh2HostKeyVerdict> {
  const { resolved } = options
  // ssh keys known_hosts by HostKeyAlias, else the dialled HostName — never the Orca label.
  const host = resolved?.hostKeyAlias ?? config.host ?? ''
  const isHostKeyAlias = Boolean(resolved?.hostKeyAlias)
  const port = config.port ?? 22
  const strictHostKeyChecking = resolved?.strictHostKeyChecking ?? 'ask'
  const ephemeral = options.target.owner?.type === 'on-demand-runtime'
  const loaded = await withTimeout(
    loadHostKeyTrustSources(resolved?.knownHostsFiles ?? []).catch((err) => {
      console.warn('[ssh] failed to load host key trust sources:', err)
      return null
    }),
    TRUST_SOURCE_READ_TIMEOUT_MS,
    null
  )
  if (!loaded && !ephemeral && !isHostKeyCheckingOff(strictHostKeyChecking)) {
    throw new HostKeyVerificationError(
      `Host key verification failed for ${host}. Its known_hosts files could not be read.`,
      'unknown'
    )
  }
  const sources = loaded ?? { knownHosts: [], trustSourceUnreadable: true, orcaStore: [] }
  const verdict: Ssh2HostKeyVerdict = { rejection: null }
  config.hostVerifier = createHostKeyVerifier({
    host,
    port,
    isHostKeyAlias,
    strictHostKeyChecking,
    ephemeral,
    trustSourceUnreadable: sources.trustSourceUnreadable,
    knownHosts: sources.knownHosts,
    orcaStore: sources.orcaStore,
    rememberHostKey: (record) => {
      if (!options.isCurrentAttempt()) {
        return
      }
      void rememberHostKey(record).catch((err) => {
        console.warn('[ssh] failed to record accepted host key:', err)
      })
    },
    onDecision: (decision) => {
      if (!options.isCurrentAttempt()) {
        return
      }
      if (decision.action === 'reject') {
        verdict.rejection = new HostKeyVerificationError(
          decision.reason ?? 'Host key verification failed.',
          decision.outcome
        )
      } else if (decision.fingerprint) {
        options.onAcceptedFingerprint(decision.fingerprint)
      }
    }
  })
  const defaults = readSsh2DefaultHostKeyAlgorithms()
  const order = defaults
    ? orderServerHostKeyAlgorithms(
        [...sources.knownHosts, ...sources.orcaStore],
        host,
        port,
        defaults,
        isHostKeyAlias
      )
    : undefined
  if (order) {
    config.algorithms = {
      ...config.algorithms,
      // Every name comes from ssh2's runtime list, which the @types/ssh2 literal union lags.
      serverHostKey: order as NonNullable<ConnectConfig['algorithms']>['serverHostKey']
    }
  }
  return verdict
}
