import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fingerprintClaudeRefreshChain } from './claude-refresh-chain-fingerprint'
import {
  CLAUDE_REFRESH_CHAIN_LEASE_TTL_MS,
  ClaudeRefreshChainLeaseStore
} from './claude-refresh-chain-lease'
import { claudeRefreshClaimPath } from './claude-refresh-chain-lease-paths'

const roots: string[] = []

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
})
