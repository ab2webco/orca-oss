import { describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import type { SshPtyConsumerOwnerState } from './ssh-pty-consumer-session'
import {
  claimSshPtyConsumerRecovery,
  detachSshPtyConsumerRecovery,
  rememberSshPtyConsumerRecovery,
  settleSshPtyConsumerIdentity
} from './ssh-pty-consumer-recovery'

describe('SSH PTY consumer recovery', () => {
  it('keeps a detached identity when a concurrent open finishes late', async () => {
    const targetId = 'remember-detach-race'
    const store = {
      getSshPtyConsumerRecovery: vi.fn().mockReturnValue(null),
      upsertSshPtyConsumerRecovery: vi.fn()
    } as unknown as Store
    const claimed = claimSshPtyConsumerRecovery(targetId, store)
    let finishOpen!: (owner: SshPtyConsumerOwnerState) => void
    const opened = new Promise<SshPtyConsumerOwnerState>((resolve) => {
      finishOpen = resolve
    })
    const remembering = opened.then((owner) =>
      rememberSshPtyConsumerRecovery({
        targetId,
        clientInstanceId: claimed.clientInstanceId,
        serverBuildId: 'relay-build',
        owner,
        store
      })
    )

    detachSshPtyConsumerRecovery(targetId, claimed.clientInstanceId)
    finishOpen({
      mode: 'negotiated',
      clientInstanceId: claimed.clientInstanceId,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'late-owner'
    })
    await remembering

    expect(store.upsertSshPtyConsumerRecovery).not.toHaveBeenCalled()
    expect(claimSshPtyConsumerRecovery(targetId, store)).toBe(claimed)
  })

  it('keeps an identity once its first grant settled it', () => {
    const targetId = 'settled-before-unseal'
    const getRecovery = vi.fn().mockReturnValue(null)
    const store = { getSshPtyConsumerRecovery: getRecovery } as unknown as Store
    const claimed = claimSshPtyConsumerRecovery(targetId, store)
    const minted = claimed.clientInstanceId

    expect(settleSshPtyConsumerIdentity(targetId, minted, store)).toBe(minted)
    getRecovery.mockReturnValue({
      targetId,
      clientInstanceId: 'unsealed-too-late',
      serverBuildId: 'relay-build',
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'late-owner'
    })

    expect(settleSshPtyConsumerIdentity(targetId, minted, store)).toBe(minted)
    expect(claimed.clientInstanceId).toBe(minted)
    expect(claimed.owner).toBeUndefined()
  })

  it('leaves an identity read from the store as it is', () => {
    const targetId = 'claimed-after-unseal'
    const store = {
      getSshPtyConsumerRecovery: vi.fn().mockReturnValue({
        targetId,
        clientInstanceId: 'persisted-client',
        serverBuildId: 'relay-build',
        clientGeneration: 2,
        ownerGeneration: 3,
        ownerLease: 'persisted-owner'
      })
    } as unknown as Store
    const claimed = claimSshPtyConsumerRecovery(targetId, store)

    expect(settleSshPtyConsumerIdentity(targetId, 'persisted-client', store)).toBe(
      'persisted-client'
    )
    expect(store.getSshPtyConsumerRecovery).toHaveBeenCalledTimes(1)
    expect(claimed.owner).toMatchObject({ ownerGeneration: 3, ownerLease: 'persisted-owner' })
  })
})
