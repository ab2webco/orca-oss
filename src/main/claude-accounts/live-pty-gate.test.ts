import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachClaudeLivePtyPersistence,
  beginManagedClaudeAccountMutation,
  beginClaudeAuthSwitch,
  confirmSeededClaudeLivePtys,
  endClaudeAuthSwitch,
  endManagedClaudeAccountMutation,
  getLiveInjectedClaudePtyAccountId,
  hasLiveInjectedClaudePtysForAccount,
  hasLiveClaudePtys,
  isClaudeAuthSwitchInProgress,
  markClaudePtyExited,
  markClaudePtySpawned,
  markInjectedClaudePtySpawned,
  releaseInjectedClaudeAccountLaunch,
  releaseSharedClaudeAccountLaunch,
  reserveInjectedClaudeAccountLaunch,
  reserveSharedClaudeAccountLaunch,
  seedLiveClaudePtysFromPersistence,
  seedLiveInjectedClaudePtysFromPersistence
} from './live-pty-gate'

describe('Claude live PTY gate', () => {
  afterEach(() => {
    markClaudePtyExited('live-claude-pty')
    markClaudePtyExited('seeded-pty-1')
    markClaudePtyExited('seeded-pty-2')
    markClaudePtyExited('injected-pty')
    confirmSeededClaudeLivePtys([])
    attachClaudeLivePtyPersistence(null)
    endManagedClaudeAccountMutation('account-a')
    endClaudeAuthSwitch()
  })

  it('allows switching while Claude PTYs are live', () => {
    markClaudePtySpawned('live-claude-pty')

    beginClaudeAuthSwitch()

    expect(isClaudeAuthSwitchInProgress()).toBe(true)
  })

  it('still rejects overlapping account switches', () => {
    beginClaudeAuthSwitch()

    expect(() => beginClaudeAuthSwitch()).toThrow('already in progress')
  })

  it('counts seeded session ids as live until confirmed dead', () => {
    seedLiveClaudePtysFromPersistence(['seeded-pty-1', 'seeded-pty-2'])

    expect(hasLiveClaudePtys()).toBe(true)

    confirmSeededClaudeLivePtys(['seeded-pty-1'])

    expect(hasLiveClaudePtys()).toBe(true)

    confirmSeededClaudeLivePtys([])

    expect(hasLiveClaudePtys()).toBe(true)

    markClaudePtyExited('seeded-pty-1')

    expect(hasLiveClaudePtys()).toBe(false)
  })

  it('releases seeded ids the daemon no longer knows', () => {
    const removeClaudeLivePtySessionId = vi.fn()
    attachClaudeLivePtyPersistence({
      addClaudeLivePtySessionId: vi.fn(),
      removeClaudeLivePtySessionId
    })
    seedLiveClaudePtysFromPersistence(['seeded-pty-1', 'seeded-pty-2'])

    confirmSeededClaudeLivePtys(['seeded-pty-2'])

    expect(hasLiveClaudePtys()).toBe(true)
    expect(removeClaudeLivePtySessionId).toHaveBeenCalledWith('seeded-pty-1')
    expect(removeClaudeLivePtySessionId).not.toHaveBeenCalledWith('seeded-pty-2')
  })

  it('keeps a seeded id confirmed by a real spawn out of later pruning', () => {
    seedLiveClaudePtysFromPersistence(['seeded-pty-1'])
    markClaudePtySpawned('seeded-pty-1')

    confirmSeededClaudeLivePtys([])

    expect(hasLiveClaudePtys()).toBe(true)
  })

  it('persists spawns and exits when persistence is attached', () => {
    const addClaudeLivePtySessionId = vi.fn()
    const removeClaudeLivePtySessionId = vi.fn()
    attachClaudeLivePtyPersistence({
      addClaudeLivePtySessionId,
      removeClaudeLivePtySessionId
    })

    markClaudePtySpawned('live-claude-pty')
    expect(addClaudeLivePtySessionId).toHaveBeenCalledWith('live-claude-pty')

    markClaudePtyExited('live-claude-pty')
    expect(removeClaudeLivePtySessionId).toHaveBeenCalledWith('live-claude-pty')
  })

  it('tracks injected PTYs by account without closing the shared auth gate', () => {
    const addClaudeLivePtyAccountBinding = vi.fn()
    const removeClaudeLivePtyAccountBinding = vi.fn()
    attachClaudeLivePtyPersistence({
      addClaudeLivePtySessionId: vi.fn(),
      removeClaudeLivePtySessionId: vi.fn(),
      addClaudeLivePtyAccountBinding,
      removeClaudeLivePtyAccountBinding
    })

    markInjectedClaudePtySpawned('injected-pty', 'account-a')

    expect(hasLiveClaudePtys()).toBe(false)
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(true)
    expect(hasLiveInjectedClaudePtysForAccount('account-b')).toBe(false)
    expect(addClaudeLivePtyAccountBinding).toHaveBeenCalledWith('injected-pty', 'account-a')

    markClaudePtyExited('injected-pty')
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(false)
    expect(removeClaudeLivePtyAccountBinding).toHaveBeenCalledWith('injected-pty')
  })

  it('keeps injected account ownership across restart reconciliation', () => {
    seedLiveInjectedClaudePtysFromPersistence([
      { sessionId: 'injected-pty', accountId: 'account-a' }
    ])

    confirmSeededClaudeLivePtys(['injected-pty'])

    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(true)
  })

  it('reserves account ownership while an injected PTY spawn is pending', () => {
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(true)

    releaseInjectedClaudeAccountLaunch(reservationId)
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(false)
  })

  it('does not expire a reservation while a legitimate launch is still pending', () => {
    vi.useFakeTimers()
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')

    vi.advanceTimersByTime(120_000)

    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(true)
    releaseInjectedClaudeAccountLaunch(reservationId)
  })

  it('atomically consumes a matching reservation into live ownership', () => {
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')

    markInjectedClaudePtySpawned('injected-pty', 'account-a', reservationId)

    expect(getLiveInjectedClaudePtyAccountId('injected-pty')).toBe('account-a')
    markClaudePtyExited('injected-pty')
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(false)
  })

  it('rolls back live ownership when durable binding persistence fails', () => {
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')
    attachClaudeLivePtyPersistence({
      addClaudeLivePtySessionId: vi.fn(),
      removeClaudeLivePtySessionId: vi.fn(),
      addClaudeLivePtyAccountBinding: vi.fn(() => {
        throw new Error('disk full')
      })
    })

    expect(() => markInjectedClaudePtySpawned('injected-pty', 'account-a', reservationId)).toThrow(
      'disk full'
    )
    expect(getLiveInjectedClaudePtyAccountId('injected-pty')).toBeNull()
    expect(hasLiveInjectedClaudePtysForAccount('account-a')).toBe(false)
  })

  it('never overwrites a surviving PTY binding with a later worktree pin', () => {
    markInjectedClaudePtySpawned('injected-pty', 'account-a')

    expect(() => markInjectedClaudePtySpawned('injected-pty', 'account-b')).toThrow(
      'cannot change its assigned account'
    )
    expect(getLiveInjectedClaudePtyAccountId('injected-pty')).toBe('account-a')
  })

  it('excludes new launches for the full managed-account mutation', () => {
    beginManagedClaudeAccountMutation('account-a')

    expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow('being changed')

    endManagedClaudeAccountMutation('account-a')
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')
    releaseInjectedClaudeAccountLaunch(reservationId)
  })

  it('owns a shared account from preparation until the PTY enters the live gate', () => {
    const reservationId = reserveSharedClaudeAccountLaunch('account-a')
    try {
      expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow(
        'being launched globally'
      )
      expect(() => beginManagedClaudeAccountMutation('account-a')).toThrow('in use')
      expect(() => beginClaudeAuthSwitch()).toThrow('global Claude terminal is starting')

      markClaudePtySpawned('live-claude-pty', reservationId)
      beginClaudeAuthSwitch()
      expect(isClaudeAuthSwitchInProgress()).toBe(true)
    } finally {
      releaseSharedClaudeAccountLaunch(reservationId)
    }
  })

  it('prevents shared preparation from racing an injected reservation', () => {
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')
    try {
      expect(() => reserveSharedClaudeAccountLaunch('account-a')).toThrow('assigned worktree')
    } finally {
      releaseInjectedClaudeAccountLaunch(reservationId)
    }
  })

  it('protects a system-default shared launch even without a managed account id', () => {
    const reservationId = reserveSharedClaudeAccountLaunch(null)
    try {
      expect(() => beginClaudeAuthSwitch()).toThrow('global Claude terminal is starting')
    } finally {
      releaseSharedClaudeAccountLaunch(reservationId)
    }
  })
})
