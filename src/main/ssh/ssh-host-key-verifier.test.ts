import { describe, expect, it, vi } from 'vitest'
import { parseKnownHosts } from './ssh-known-hosts'
import {
  createHostKeyVerifier,
  decideHostKey,
  orderServerHostKeyAlgorithms,
  type HostKeyVerifierDeps
} from './ssh-host-key-verifier'
import { hostKeyBlob, knownHostsLine } from './ssh-host-key-test-keys'

const ED = 'ssh-ed25519'
const SSH2_DEFAULTS = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa'
]

function decide(overrides: Partial<Parameters<typeof decideHostKey>[0]> = {}) {
  return decideHostKey({
    knownHostsOutcome: 'unknown',
    storeOutcome: 'unknown',
    strictHostKeyChecking: 'ask',
    ephemeral: false,
    trustSourceUnreadable: false,
    displayHost: 'host.example',
    port: 22,
    ...overrides
  })
}

describe('decideHostKey', () => {
  it('rejects revoked and changed keys even with StrictHostKeyChecking=no', () => {
    expect(decide({ knownHostsOutcome: 'revoked', strictHostKeyChecking: 'false' }).action).toBe(
      'reject'
    )
    const changed = decide({
      knownHostsOutcome: 'mismatch',
      strictHostKeyChecking: 'false'
    })
    expect(changed.action).toBe('reject')
    expect(changed.reason).toContain('ssh-keygen -R host.example')
    expect(decide({ storeOutcome: 'mismatch' }).action).toBe('reject')
    expect(decide({ knownHostsOutcome: 'unknown-type-known-host' }).action).toBe('reject')
  })

  it('names the bracketed form for ssh-keygen -R off port 22', () => {
    expect(decide({ knownHostsOutcome: 'mismatch', port: 2222 }).reason).toContain(
      "ssh-keygen -R '[host.example]:2222'"
    )
  })

  it('keeps rejection text out of the auth-failure phrases the reconnect ladder retries', () => {
    const reason = decide({ knownHostsOutcome: 'mismatch' }).reason?.toLowerCase() ?? ''
    expect(reason).not.toContain('authentication failed')
    expect(reason).not.toContain('permission denied')
  })

  it('trusts known_hosts over a stale Orca record', () => {
    expect(decide({ knownHostsOutcome: 'match', storeOutcome: 'mismatch' }).action).toBe('accept')
    expect(decide({ storeOutcome: 'match' }).action).toBe('accept')
  })

  it('remembers first contact only when nothing forbids it', () => {
    expect(decide().action).toBe('accept-and-remember')
    expect(decide({ strictHostKeyChecking: 'true' }).action).toBe('reject')
    expect(decide({ strictHostKeyChecking: 'false' }).action).toBe('accept')
    expect(decide({ ephemeral: true }).action).toBe('accept')
  })

  it('refuses first contact when a trust source could not be read, unless checking is off', () => {
    const refused = decide({ trustSourceUnreadable: true })
    expect(refused.action).toBe('reject')
    expect(refused.reason?.toLowerCase()).not.toContain('authentication failed')
    expect(decide({ trustSourceUnreadable: true, strictHostKeyChecking: 'false' }).action).toBe(
      'accept'
    )
    expect(decide({ trustSourceUnreadable: true, knownHostsOutcome: 'match' }).action).toBe(
      'accept'
    )
  })

  it('refuses a host only a @cert-authority line names when StrictHostKeyChecking is ask', () => {
    expect(decide({ knownHostsOutcome: 'ca-only' }).action).toBe('reject')
    expect(
      decide({ knownHostsOutcome: 'ca-only', strictHostKeyChecking: 'accept-new' }).action
    ).toBe('accept-and-remember')
    expect(decide({ knownHostsOutcome: 'ca-only', strictHostKeyChecking: 'false' }).action).toBe(
      'accept'
    )
  })
})

describe('createHostKeyVerifier', () => {
  function verifierDeps(overrides: Partial<HostKeyVerifierDeps> = {}): HostKeyVerifierDeps {
    return {
      host: 'host.example',
      port: 22,
      strictHostKeyChecking: 'ask',
      ephemeral: false,
      trustSourceUnreadable: false,
      knownHosts: [],
      orcaStore: [],
      rememberHostKey: vi.fn(),
      onDecision: vi.fn(),
      ...overrides
    }
  }

  it('answers through the callback and returns undefined, never a Promise', () => {
    const deps = verifierDeps()
    const verify = vi.fn()
    expect(createHostKeyVerifier(deps)(hostKeyBlob(ED, 1), verify)).toBeUndefined()
    expect(verify).toHaveBeenCalledWith(true)
    expect(deps.rememberHostKey).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'host.example', port: 22, keyType: ED })
    )
  })

  it('refuses a key that differs from known_hosts and records nothing', () => {
    const deps = verifierDeps({
      knownHosts: parseKnownHosts(knownHostsLine('host.example', ED, 1))
    })
    const verify = vi.fn()
    createHostKeyVerifier(deps)(hostKeyBlob(ED, 2), verify)
    expect(verify).toHaveBeenCalledWith(false)
    expect(deps.rememberHostKey).not.toHaveBeenCalled()
    expect(deps.onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reject', outcome: 'mismatch' })
    )
  })

  it('refuses a key that differs from the Orca store', () => {
    const deps = verifierDeps({
      orcaStore: parseKnownHosts(knownHostsLine('host.example', ED, 1))
    })
    const verify = vi.fn()
    createHostKeyVerifier(deps)(hostKeyBlob(ED, 2), verify)
    expect(verify).toHaveBeenCalledWith(false)
  })

  it('denies an unreadable key and a throwing dependency instead of hanging', () => {
    const verify = vi.fn()
    createHostKeyVerifier(verifierDeps())(Buffer.from('mock-ssh-host-key'), verify)
    expect(verify).toHaveBeenCalledWith(false)

    const throwing = verifierDeps({
      rememberHostKey: () => {
        throw new Error('disk full')
      }
    })
    const verifyAfterThrow = vi.fn()
    createHostKeyVerifier(throwing)(hostKeyBlob(ED, 1), verifyAfterThrow)
    expect(verifyAfterThrow).toHaveBeenCalledWith(false)
  })
})

describe('orderServerHostKeyAlgorithms', () => {
  it('leaves defaults alone for an unknown host', () => {
    expect(orderServerHostKeyAlgorithms([], 'host.example', 22, SSH2_DEFAULTS)).toBeUndefined()
  })

  it('puts the known type first so another type cannot pass as first contact', () => {
    const known = parseKnownHosts(knownHostsLine('host.example', 'ssh-rsa', 1))
    expect(orderServerHostKeyAlgorithms(known, 'host.example', 22, SSH2_DEFAULTS)).toEqual([
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
      'ssh-ed25519',
      'ecdsa-sha2-nistp256'
    ])
  })
})
