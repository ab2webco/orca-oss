import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachLiveClaudePtyGateInventory,
  reconcileLiveClaudePtyGate
} from './live-claude-pty-gate-reconciliation'
import {
  hasLiveClaudePtysUsingAccount,
  hasUnknownOwnerLiveSharedClaudePtys,
  markClaudePtyExited,
  markClaudePtySpawned,
  markInjectedClaudePtySpawned,
  reserveInjectedClaudeAccountLaunch,
  releaseInjectedClaudeAccountLaunch,
  seedLiveClaudePtysFromPersistence,
  confirmSeededClaudeLivePtys
} from './live-pty-gate'

// Why these two accounts must diverge in the SAME run: a fixture where every
// gated session is absent from the inventory passes just as green with the
// release condition inverted. Only a live session sitting beside a dead one
// proves the reconciliation reads liveness rather than releasing everything.
const LIVE_ACCOUNT = 'account-live'
const DEAD_ACCOUNT = 'account-dead'
const LIVE_PTY = 'repo::/live@@aaaa'
const DEAD_PTY = 'repo::/dead@@bbbb'

function inventory(...sessionIds: string[]) {
  return vi.fn(async () => sessionIds)
}

/** The deadlock's shape: two accounts pinned to two worktrees, one of whose
 *  PTYs the daemon killed without the main process ever observing the exit. */
function gateHoldsBothAccounts(): void {
  markInjectedClaudePtySpawned(LIVE_PTY, LIVE_ACCOUNT)
  markInjectedClaudePtySpawned(DEAD_PTY, DEAD_ACCOUNT)
}

describe('live Claude PTY gate reconciliation', () => {
  afterEach(() => {
    markClaudePtyExited(LIVE_PTY)
    markClaudePtyExited(DEAD_PTY)
    markClaudePtyExited('seeded-unknown-owner')
    confirmSeededClaudeLivePtys([])
    attachLiveClaudePtyGateInventory(null)
  })

  it('releases the account held by a session no daemon hosts', async () => {
    gateHoldsBothAccounts()
    expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(true)

    const released = await reconcileLiveClaudePtyGate({ inventory: inventory(LIVE_PTY) })

    expect(released).toEqual([DEAD_PTY])
    expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(false)
  })

  it('keeps protecting the account whose session the daemon still reports', async () => {
    gateHoldsBothAccounts()

    await reconcileLiveClaudePtyGate({ inventory: inventory(LIVE_PTY) })

    expect(hasLiveClaudePtysUsingAccount(LIVE_ACCOUNT)).toBe(true)
  })

  it('releases nothing when the inventory cannot be established', async () => {
    gateHoldsBothAccounts()

    const released = await reconcileLiveClaudePtyGate({ inventory: vi.fn(async () => null) })

    expect(released).toEqual([])
    expect(hasLiveClaudePtysUsingAccount(LIVE_ACCOUNT)).toBe(true)
    expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(true)
  })

  it('releases nothing when the inventory throws', async () => {
    gateHoldsBothAccounts()

    const released = await reconcileLiveClaudePtyGate({
      inventory: vi.fn(async () => {
        throw new Error('daemon unreachable')
      })
    })

    expect(released).toEqual([])
    expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(true)
  })

  it('keeps a session that registered while the inventory was in flight', async () => {
    // The gate must already hold something, or the pass short-circuits before
    // it can probe — the launch this test is about happens during that probe.
    markInjectedClaudePtySpawned(DEAD_PTY, DEAD_ACCOUNT)

    const released = await reconcileLiveClaudePtyGate({
      inventory: vi.fn(async () => {
        markInjectedClaudePtySpawned(LIVE_PTY, LIVE_ACCOUNT)
        return []
      })
    })

    // The inventory could not have seen this launch, so its silence is not
    // evidence the session is dead.
    expect(released).toEqual([DEAD_PTY])
    expect(hasLiveClaudePtysUsingAccount(LIVE_ACCOUNT)).toBe(true)
  })

  it('clears an unknown-owner shared session the daemon never reports', async () => {
    seedLiveClaudePtysFromPersistence(['seeded-unknown-owner'])
    expect(hasUnknownOwnerLiveSharedClaudePtys()).toBe(true)
    // An unknown owner is a wildcard: it blocks rotation for every account.
    expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(true)

    await reconcileLiveClaudePtyGate({ inventory: inventory(LIVE_PTY) })

    expect(hasUnknownOwnerLiveSharedClaudePtys()).toBe(false)
    expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(false)
  })

  it('never releases a launch reservation, which names no session yet', async () => {
    markClaudePtySpawned(LIVE_PTY, null)
    const reservationId = reserveInjectedClaudeAccountLaunch(DEAD_ACCOUNT)
    try {
      await reconcileLiveClaudePtyGate({ inventory: inventory(LIVE_PTY) })

      expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(true)
    } finally {
      releaseInjectedClaudeAccountLaunch(reservationId)
    }
  })

  it('does not probe the daemon when the gate is empty', async () => {
    const probe = inventory(LIVE_PTY)

    await reconcileLiveClaudePtyGate({ inventory: probe })

    expect(probe).not.toHaveBeenCalled()
  })

  it('uses the attached inventory when the caller supplies none', async () => {
    gateHoldsBothAccounts()
    attachLiveClaudePtyGateInventory(inventory(LIVE_PTY))

    await reconcileLiveClaudePtyGate()

    expect(hasLiveClaudePtysUsingAccount(DEAD_ACCOUNT)).toBe(false)
    expect(hasLiveClaudePtysUsingAccount(LIVE_ACCOUNT)).toBe(true)
  })
})
