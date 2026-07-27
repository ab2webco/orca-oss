import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachClaudeLivePtyPersistence,
  beginManagedClaudeAccountMutation,
  beginClaudeAuthSwitch,
  confirmSeededClaudeLivePtys,
  endClaudeAuthSwitch,
  endManagedClaudeAccountMutation,
  getLiveInjectedClaudePtyAccountId,
  getLiveSharedClaudePtyAccountId,
  hasLiveSharedClaudePtysForAccount,
  hasLiveInjectedClaudePtysForAccount,
  hasLiveClaudePtys,
  hasLiveClaudePtysUsingAccount,
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
import { onLiveClaudePtysDrained } from './live-pty-drain-listeners'
import {
  runManagedClaudeAccountMutation,
  runManagedClaudeAccountRead,
  tryRunManagedClaudeAccountMutation
} from './run-managed-claude-account-mutation'

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

  it('preserves shared launch-account ownership across restart seeding', () => {
    seedLiveClaudePtysFromPersistence(
      ['seeded-pty-1'],
      [{ sessionId: 'seeded-pty-1', accountId: 'account-a' }]
    )

    expect(getLiveSharedClaudePtyAccountId('seeded-pty-1')).toBe('account-a')
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
    expect(hasLiveSharedClaudePtysForAccount('account-b')).toBe(false)
    expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow(
      'already in use by a global terminal'
    )
  })

  it('treats legacy shared sessions with unknown accounts conservatively', () => {
    seedLiveClaudePtysFromPersistence(['seeded-pty-1'])

    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
    expect(hasLiveSharedClaudePtysForAccount('account-b')).toBe(true)
  })

  it('notifies drain listeners only when the last live Claude PTY exits', () => {
    const onDrained = vi.fn()
    const unsubscribe = onLiveClaudePtysDrained(onDrained)
    try {
      markClaudePtySpawned('live-claude-pty')
      markClaudePtySpawned('seeded-pty-1')

      markClaudePtyExited('live-claude-pty')
      expect(onDrained).not.toHaveBeenCalled()

      markClaudePtyExited('seeded-pty-1')
      expect(onDrained).toHaveBeenCalledTimes(1)

      // Why: exits with no live PTYs left must not fire again — the drain
      // signal marks the 1 -> 0 transition, not every teardown call.
      markClaudePtyExited('seeded-pty-1')
      expect(onDrained).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('notifies drain listeners when seed reconciliation releases the last live id', () => {
    const onDrained = vi.fn()
    const unsubscribe = onLiveClaudePtysDrained(onDrained)
    try {
      seedLiveClaudePtysFromPersistence(['seeded-pty-1'])

      confirmSeededClaudeLivePtys([])

      expect(onDrained).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('stops notifying an unsubscribed drain listener', () => {
    const onDrained = vi.fn()
    const unsubscribe = onLiveClaudePtysDrained(onDrained)
    unsubscribe()

    markClaudePtySpawned('live-claude-pty')
    markClaudePtyExited('live-claude-pty')

    expect(onDrained).not.toHaveBeenCalled()
  })

  it('persists spawns and exits when persistence is attached', () => {
    const addClaudeLivePtySessionId = vi.fn()
    const removeClaudeLivePtySessionId = vi.fn()
    attachClaudeLivePtyPersistence({
      addClaudeLivePtySessionId,
      removeClaudeLivePtySessionId
    })

    markClaudePtySpawned('live-claude-pty')
    expect(addClaudeLivePtySessionId).toHaveBeenCalledWith('live-claude-pty', null)

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

  it('rolls back shared ownership when durable account persistence fails', () => {
    const reservationId = reserveSharedClaudeAccountLaunch('account-a')
    attachClaudeLivePtyPersistence({
      addClaudeLivePtySessionId: vi.fn(() => {
        throw new Error('disk full')
      }),
      removeClaudeLivePtySessionId: vi.fn()
    })

    expect(() => markClaudePtySpawned('live-claude-pty', 'account-a', reservationId)).toThrow(
      'disk full'
    )
    expect(hasLiveClaudePtys()).toBe(false)
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(false)
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
      expect(() => beginManagedClaudeAccountMutation('account-a')).toThrow(
        'global Claude terminal launch is still starting'
      )
      expect(() => beginClaudeAuthSwitch()).toThrow('global Claude terminal is starting')

      markClaudePtySpawned('live-claude-pty', 'account-a', reservationId)
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
      expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow(
        'being launched globally'
      )
      expect(() => beginManagedClaudeAccountMutation('account-a')).toThrow(
        'global Claude terminal launch is still starting'
      )
    } finally {
      releaseSharedClaudeAccountLaunch(reservationId)
    }
  })

  it('lets unrelated account-record mutations pass an ownerless shared reservation', async () => {
    const reservationId = reserveSharedClaudeAccountLaunch(null)
    try {
      await expect(
        runManagedClaudeAccountMutation('account-a', async () => 'removed', {
          intent: 'account-record'
        })
      ).resolves.toBe('removed')
      expect(() => beginManagedClaudeAccountMutation('account-a')).toThrow(
        'global Claude terminal launch is still starting'
      )
    } finally {
      releaseSharedClaudeAccountLaunch(reservationId)
    }
  })

  it('expires launch reservations after five minutes as a failed-launch safety net', () => {
    vi.useFakeTimers()
    reserveSharedClaudeAccountLaunch(null)

    vi.advanceTimersByTime(300_001)

    expect(() => beginManagedClaudeAccountMutation('account-a')).not.toThrow()
    endManagedClaudeAccountMutation('account-a')
  })

  it('reports live ownership for both shared and pinned Claude terminals', () => {
    expect(hasLiveClaudePtysUsingAccount('account-a')).toBe(false)

    markInjectedClaudePtySpawned('injected-pty', 'account-a')
    expect(hasLiveClaudePtysUsingAccount('account-a')).toBe(true)
    expect(hasLiveClaudePtysUsingAccount('account-b')).toBe(false)
    markClaudePtyExited('injected-pty')

    markClaudePtySpawned('live-claude-pty', 'account-a')
    expect(hasLiveClaudePtysUsingAccount('account-a')).toBe(true)
    markClaudePtyExited('live-claude-pty')
  })

  it('lets a read run under live PTYs but yields to an in-flight mutation', async () => {
    markInjectedClaudePtySpawned('injected-pty', 'account-a')
    try {
      // Why: a usage read changes nothing, so live ownership must not block it.
      await expect(runManagedClaudeAccountRead('account-a', async () => 'read')).resolves.toBe(
        'read'
      )
    } finally {
      markClaudePtyExited('injected-pty')
    }

    beginManagedClaudeAccountMutation('account-a')
    try {
      await expect(runManagedClaudeAccountRead('account-a', async () => 'read')).rejects.toThrow(
        'being changed'
      )
    } finally {
      endManagedClaudeAccountMutation('account-a')
    }
  })

  it('lets a read nested inside its own mutation proceed', async () => {
    await runManagedClaudeAccountMutation('account-a', async () => {
      await expect(runManagedClaudeAccountRead('account-a', async () => 'read')).resolves.toBe(
        'read'
      )
    })
  })

  it('try-mutation acquires when idle and yields to live owners instead of throwing', async () => {
    await expect(
      tryRunManagedClaudeAccountMutation('account-a', async () => 'ran')
    ).resolves.toEqual({ acquired: true, value: 'ran' })

    // Yields to a launch reservation — the race a pre-checked rotation must lose.
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')
    try {
      await expect(
        tryRunManagedClaudeAccountMutation('account-a', async () => 'ran')
      ).resolves.toEqual({ acquired: false })
    } finally {
      releaseInjectedClaudeAccountLaunch(reservationId)
    }

    // Yields to a live PTY and to an in-flight mutation.
    markInjectedClaudePtySpawned('injected-pty', 'account-a')
    try {
      await expect(
        tryRunManagedClaudeAccountMutation('account-a', async () => 'ran')
      ).resolves.toEqual({ acquired: false })
    } finally {
      markClaudePtyExited('injected-pty')
    }
    beginManagedClaudeAccountMutation('account-a')
    try {
      await expect(
        tryRunManagedClaudeAccountMutation('account-a', async () => 'ran')
      ).resolves.toEqual({ acquired: false })
    } finally {
      endManagedClaudeAccountMutation('account-a')
    }

    // Reentrant inside its own mutation, and releases the gate afterwards.
    await runManagedClaudeAccountMutation('account-a', async () => {
      await expect(
        tryRunManagedClaudeAccountMutation('account-a', async () => 'ran')
      ).resolves.toEqual({ acquired: true, value: 'ran' })
    })
    expect(() => beginManagedClaudeAccountMutation('account-a')).not.toThrow()
    endManagedClaudeAccountMutation('account-a')
  })

  it('prevents unknown shared preparation from racing account-specific ownership', () => {
    const reservationId = reserveInjectedClaudeAccountLaunch('account-a')
    try {
      expect(() => reserveSharedClaudeAccountLaunch(null)).toThrow('assigned worktree')
    } finally {
      releaseInjectedClaudeAccountLaunch(reservationId)
    }

    beginManagedClaudeAccountMutation('account-a')
    try {
      expect(() => reserveSharedClaudeAccountLaunch(null)).toThrow('being changed')
    } finally {
      endManagedClaudeAccountMutation('account-a')
    }
  })
})
