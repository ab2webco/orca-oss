import { describe, expect, it } from 'vitest'
import { matchKnownHosts, parseKnownHosts, readHostKeyType } from './ssh-known-hosts'
import { hashedHost, hostKeyBlob, knownHostsLine } from './ssh-host-key-test-keys'

const ED = 'ssh-ed25519'
const RSA = 'ssh-rsa'

function match(contents: string, host: string, port: number, keyType: string, seed: number) {
  return matchKnownHosts(parseKnownHosts(contents), {
    host,
    port,
    keyType,
    key: hostKeyBlob(keyType, seed)
  })
}

describe('parseKnownHosts', () => {
  it('skips comments, blank lines, unknown markers and malformed keys', () => {
    const entries = parseKnownHosts(
      [
        '# comment',
        '',
        '@weird host ssh-ed25519 AAAA',
        `host ${ED} not-base64!`,
        // Declared type disagrees with the blob's own type.
        `host ${RSA} ${hostKeyBlob(ED, 1).toString('base64')}`,
        knownHostsLine('a.example,b.example', ED, 1)
      ].join('\n')
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      patterns: ['a.example', 'b.example'],
      keyType: ED
    })
  })

  it('reads the key type from the blob header', () => {
    expect(readHostKeyType(hostKeyBlob(ED, 1))).toBe(ED)
    expect(readHostKeyType(Buffer.from('mock-ssh-host-key'))).toBeUndefined()
  })
})

describe('matchKnownHosts', () => {
  it('matches the same key and reports a changed key of the same type', () => {
    const file = knownHostsLine('host.example', ED, 1)
    expect(match(file, 'host.example', 22, ED, 1)).toBe('match')
    expect(match(file, 'HOST.example', 22, ED, 2)).toBe('mismatch')
    expect(match(file, 'other.example', 22, ED, 2)).toBe('unknown')
  })

  it('never reads a different key type on a known host as first contact', () => {
    const file = knownHostsLine('host.example', RSA, 1)
    expect(match(file, 'host.example', 22, ED, 1)).toBe('unknown-type-known-host')
  })

  it('looks up [host]:port first and lets the bare fallback only match', () => {
    const bare = knownHostsLine('host.example', ED, 1)
    expect(match(bare, 'host.example', 2222, ED, 1)).toBe('match')
    expect(match(bare, 'host.example', 2222, ED, 2)).toBe('unknown')
    const ported = knownHostsLine('[host.example]:2222', ED, 1)
    expect(match(ported, 'host.example', 2222, ED, 2)).toBe('mismatch')
    expect(match(ported, 'host.example', 22, ED, 2)).toBe('unknown')
  })

  it('matches hashed entries, globs, and lets a negation veto the line', () => {
    expect(
      match(knownHostsLine(hashedHost('host.example'), ED, 1), 'host.example', 22, ED, 2)
    ).toBe('mismatch')
    expect(
      match(knownHostsLine(hashedHost('[host.example]:2200'), ED, 1), 'host.example', 2200, ED, 1)
    ).toBe('match')
    expect(match(knownHostsLine('*.example', ED, 1), 'a.example', 22, ED, 2)).toBe('mismatch')
    expect(match(knownHostsLine('*.example,!a.example', ED, 1), 'a.example', 22, ED, 2)).toBe(
      'unknown'
    )
  })

  it('resolves revocation regardless of line order', () => {
    const revoked = `@revoked ${knownHostsLine('host.example', ED, 1)}`
    const trusted = knownHostsLine('host.example', ED, 1)
    expect(match([trusted, revoked].join('\n'), 'host.example', 22, ED, 1)).toBe('revoked')
    expect(match([revoked, trusted].join('\n'), 'host.example', 22, ED, 1)).toBe('revoked')
  })

  it('does not let a cert-authority line vouch for a plain key', () => {
    const ca = `@cert-authority ${knownHostsLine('*.example', ED, 1)}`
    expect(match(ca, 'host.example', 22, ED, 1)).toBe('ca-only')
  })
})
