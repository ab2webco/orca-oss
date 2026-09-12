import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fingerprintClaudeRefreshChain } from './claude-refresh-chain-fingerprint'
import { claudeRefreshChainIdentityKey } from './claude-refresh-chain-identity'
import {
  CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS,
  ClaudeRefreshChainLeaseStore
} from './claude-refresh-chain-lease'
import { claudeRefreshClaimPath } from './claude-refresh-chain-lease-paths'
import { readClaudeRefreshChainLeaseRecord } from './claude-refresh-chain-lease-record'

const roots: string[] = []

// Simulates a claim written by an Orca instance from before the identity field existed.
function stripIdentityKey(claimPath: string): void {
  const record = JSON.parse(readFileSync(claimPath, 'utf8')) as Record<string, unknown>
  delete record.identityKey
  writeFileSync(claimPath, JSON.stringify(record), 'utf8')
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-claude-chain-test-'))
  roots.push(root)
  return root
}

function credentials(refreshToken: string = randomUUID()): string {
  return JSON.stringify({ claudeAiOauth: { refreshToken } })
}

function fingerprint() {
  const value = fingerprintClaudeRefreshChain(credentials())
  if (!value) {
    throw new Error('Test credentials must have a fingerprint.')
  }
  return value
}

function identity(
  email: string = 'fabiana@koombea.com',
  organizationUuid: string = 'efb40f7b-4417-4a49-846a-b3075f27637b'
) {
  const value = claudeRefreshChainIdentityKey(email, organizationUuid)
  if (!value) {
    throw new Error('Test identities must have a key.')
  }
  return value
}

function store(rootPath: string, processId: number): ClaudeRefreshChainLeaseStore {
  return new ClaudeRefreshChainLeaseStore({
    rootPath,
    processId,
    instanceId: randomUUID(),
    processIsAlive: () => true
  })
}

describe('Claude refresh-chain lease', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses a bounded SHA-256 chain key and refuses an undeterminable token', () => {
    const first = fingerprintClaudeRefreshChain(credentials())
    const second = fingerprintClaudeRefreshChain(credentials())

    expect(first).toHaveLength(32)
    expect(second).not.toBe(first)
    expect(fingerprintClaudeRefreshChain(JSON.stringify({ claudeAiOauth: {} }))).toBeNull()
  })

  it('does not initialize lease storage before the first live claim', () => {
    vi.useFakeTimers()
    const rootPath = createRoot()
    const baselineTimerCount = vi.getTimerCount()
    const store = new ClaudeRefreshChainLeaseStore({ rootPath })

    try {
      expect(readdirSync(rootPath)).toEqual([])
      expect(vi.getTimerCount()).toBe(baselineTimerCount)

      store.registerClaim('live-session')
      expect(vi.getTimerCount()).toBe(baselineTimerCount + 1)
    } finally {
      store.releaseClaim('live-session')
      vi.useRealTimers()
    }
  })

  it('blocks rotation while a second process holds the same chain lease', () => {
    const rootPath = createRoot()
    const first = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 101,
      instanceId: randomUUID(),
      processIsAlive: () => true
    })
    const second = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 202,
      instanceId: randomUUID(),
      processIsAlive: () => true
    })
    const chain = fingerprint()
    const lease = first.tryAcquireRotation(chain)

    expect(lease).not.toBeNull()
    expect(second.tryAcquireRotation(chain)).toBeNull()

    lease?.release()
  })

  it('blocks rotation when another process publishes a live claim for the same chain', () => {
    const rootPath = createRoot()
    const liveProcess = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 303,
      instanceId: randomUUID(),
      processIsAlive: () => true
    })
    const rotatingProcess = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 404,
      instanceId: randomUUID(),
      processIsAlive: () => true
    })
    const chain = fingerprint()
    liveProcess.registerClaim('live-session')
    liveProcess.setClaimFingerprint('live-session', chain)

    expect(rotatingProcess.tryAcquireRotation(chain)).toBeNull()

    liveProcess.releaseClaim('live-session')
  })

  it('allows rotation after a crashed process lease becomes stale', () => {
    let now = 1_000
    const rootPath = createRoot()
    const crashed = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 505,
      instanceId: randomUUID(),
      now: () => now,
      processIsAlive: () => false
    })
    const replacement = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 606,
      instanceId: randomUUID(),
      now: () => now,
      processIsAlive: () => true
    })
    const chain = fingerprint()
    expect(crashed.tryAcquireRotation(chain)).not.toBeNull()

    now += CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS + 1

    expect(replacement.tryAcquireRotation(chain)).not.toBeNull()
  })

  it('sweeps claims from a replaced process instance when its first claim is registered', () => {
    const rootPath = createRoot()
    const stale = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 707,
      instanceId: randomUUID(),
      processIsAlive: () => true
    })
    const replacement = new ClaudeRefreshChainLeaseStore({
      rootPath,
      processId: 707,
      instanceId: randomUUID(),
      processIsAlive: () => true
    })

    stale.registerClaim('stale-session')
    replacement.registerClaim('replacement-session')

    expect(existsSync(claudeRefreshClaimPath(rootPath, 'stale-session'))).toBe(false)
    expect(existsSync(claudeRefreshClaimPath(rootPath, 'replacement-session'))).toBe(true)

    stale.releaseClaim('stale-session')
    replacement.releaseClaim('replacement-session')
  })

  it('blocks rotation when another instance holds the same identity under a drifted chain digest', () => {
    const rootPath = createRoot()
    const liveInstance = store(rootPath, 808)
    const rotatingInstance = store(rootPath, 909)
    const sharedIdentity = identity()
    // Why the digests differ: each Orca profile keeps its own copy of one shared chain, so the
    // live session's copy has already rotated past the one the other instance is about to refresh.
    liveInstance.registerClaim('live-session')
    liveInstance.setClaimFingerprint('live-session', fingerprint(), sharedIdentity)

    expect(rotatingInstance.tryAcquireRotation(fingerprint(), sharedIdentity)).toBeNull()

    liveInstance.releaseClaim('live-session')
  })

  it('lets a drifted chain rotate when the live claim is a different identity', () => {
    const rootPath = createRoot()
    const liveInstance = store(rootPath, 1010)
    const rotatingInstance = store(rootPath, 1111)
    liveInstance.registerClaim('live-session')
    liveInstance.setClaimFingerprint('live-session', fingerprint(), identity())

    const lease = rotatingInstance.tryAcquireRotation(fingerprint(), identity('someone@else.com'))

    expect(lease).not.toBeNull()

    lease?.release()
    liveInstance.releaseClaim('live-session')
  })

  it('falls back to digest-only when an older instance wrote a claim without an identity', () => {
    const rootPath = createRoot()
    const liveInstance = store(rootPath, 1212)
    const rotatingInstance = store(rootPath, 1313)
    const chain = fingerprint()
    liveInstance.registerClaim('live-session')
    liveInstance.setClaimFingerprint('live-session', chain)
    stripIdentityKey(claudeRefreshClaimPath(rootPath, 'live-session'))

    expect(rotatingInstance.tryAcquireRotation(chain, identity())).toBeNull()
    const lease = rotatingInstance.tryAcquireRotation(fingerprint(), identity())

    expect(lease).not.toBeNull()

    lease?.release()
    liveInstance.releaseClaim('live-session')
  })

  it('keeps a chain-digest identity out of the machine-wide claim file', () => {
    const rootPath = createRoot()
    const liveInstance = store(rootPath, 1414)
    liveInstance.registerClaim('live-session')
    liveInstance.setClaimFingerprint('live-session', fingerprint(), identity())

    const raw = readFileSync(claudeRefreshClaimPath(rootPath, 'live-session'), 'utf8')

    expect(raw).not.toContain('fabiana@koombea.com')
    expect(
      readClaudeRefreshChainLeaseRecord(claudeRefreshClaimPath(rootPath, 'live-session'))
        ?.identityKey
    ).toBe(identity())

    liveInstance.releaseClaim('live-session')
  })
})
