import { safeStorage } from 'electron'
import {
  ASYNC_DECRYPT_FAILED,
  ASYNC_DECRYPT_UNAVAILABLE,
  CREDENTIAL_KEYCHAIN_WAIT_MS,
  decryptOffMainThread
} from './integration-credential-file'

export const PROTECTED_SECRET_SLOT = {
  opencodeSessionCookie: 'settings.opencodeSessionCookie',
  httpProxyUrl: 'settings.httpProxyUrl',
  browserKagiSessionLink: 'ui.browserKagiSessionLink'
} as const

export function sshPtyOwnerLeaseSecretSlot(targetId: string): string {
  return `sshPtyConsumerRecoveries.ownerLease:${targetId}`
}

export type ProtectedSecretDecryption = {
  plaintext: string
  status: 'decrypted' | 'failed' | 'unavailable'
}

export type ProtectedSecretRetentionUpdate = {
  slot: string
  blob: string | null
}

export type LegacyPlaintextValidator = (value: string) => boolean

type ProtectedSecretEncryption = {
  blob: string
  degraded: boolean
  hashValue?: string
  retentionUpdate?: ProtectedSecretRetentionUpdate
}

// Preserve prior ciphertext or omit a new secret so unrelated state can still save safely.
export class ProtectedSecretPersistence {
  private readonly retainedBlobs = new Map<string, string>()
  private readonly sealedSlots = new Set<string>()
  // Why: the async decrypt does not warm the sync key, so re-encrypting an unchanged value would read the Keychain on the main thread.
  private readonly asyncDecryptedPlaintexts = new Map<string, string>()
  // Slots sealed without asking the sync API whether encryption is available.
  private readonly keychainDeferredSlots = new Set<string>()
  // Slots whose async read outlived the bound and may still unseal them.
  private readonly pendingKeychainSlots = new Set<string>()

  removeRetainedBlob(slot: string): void {
    this.retainedBlobs.delete(slot)
    this.sealedSlots.delete(slot)
    this.asyncDecryptedPlaintexts.delete(slot)
    this.keychainDeferredSlots.delete(slot)
    this.pendingKeychainSlots.delete(slot)
  }

  // Why: without the async API (older Electron, test doubles) load keeps decrypting in place.
  canDecryptAsync(): boolean {
    return typeof safeStorage.decryptStringAsync === 'function'
  }

  // Holds the ciphertext unread until decryptWithStatusAsync; saves keep the blob meanwhile.
  seal(slot: string, ciphertext: string): void {
    if (!ciphertext) {
      this.removeRetainedBlob(slot)
      return
    }
    this.retainedBlobs.set(slot, ciphertext)
    this.sealedSlots.add(slot)
    this.keychainDeferredSlots.add(slot)
  }

  isSealed(slot: string, value: string): boolean {
    return this.sealedSlots.has(slot) && this.retainedBlobs.get(slot) === value
  }

  commitRetentionUpdates(updates: readonly ProtectedSecretRetentionUpdate[]): void {
    for (const update of updates) {
      if (update.blob === null) {
        this.removeRetainedBlob(update.slot)
      } else {
        this.retainedBlobs.set(update.slot, update.blob)
        this.sealedSlots.delete(update.slot)
        this.asyncDecryptedPlaintexts.delete(update.slot)
        this.keychainDeferredSlots.delete(update.slot)
        this.pendingKeychainSlots.delete(update.slot)
      }
    }
  }

  encrypt(slot: string, plaintext: string): ProtectedSecretEncryption {
    const retained = this.retainedBlobs.get(slot) ?? ''
    if (!plaintext && !retained) {
      return { blob: '', degraded: false }
    }
    const sealedUnchanged =
      this.isSealed(slot, plaintext) || (!plaintext && this.sealedSlots.has(slot))
    // Why: skips the availability check, which on macOS reads the Keychain on the main thread.
    if (sealedUnchanged && this.keychainDeferredSlots.has(slot)) {
      return { blob: retained, degraded: false, hashValue: retained }
    }
    if (plaintext && this.asyncDecryptedPlaintexts.get(slot) === plaintext) {
      return { blob: retained, degraded: false }
    }
    if (!this.encryptionAvailable()) {
      return {
        blob: retained,
        degraded: true,
        ...(!plaintext && retained ? { hashValue: retained } : {})
      }
    }
    if (sealedUnchanged) {
      return { blob: retained, degraded: false, hashValue: retained }
    }
    if (!plaintext) {
      return {
        blob: '',
        degraded: false,
        retentionUpdate: { slot, blob: null }
      }
    }
    try {
      const blob = safeStorage.encryptString(plaintext).toString('base64')
      return {
        blob,
        degraded: false,
        retentionUpdate: { slot, blob }
      }
    } catch (err) {
      console.error('[persistence] Encryption failed; retaining the prior protected value:', err)
      return { blob: retained, degraded: true }
    }
  }

  decrypt(slot: string, ciphertext: string, isLegacyPlaintext?: LegacyPlaintextValidator): string {
    return this.decryptWithStatus(slot, ciphertext, isLegacyPlaintext).plaintext
  }

  decryptWithStatus(
    slot: string,
    ciphertext: string,
    isLegacyPlaintext?: LegacyPlaintextValidator
  ): ProtectedSecretDecryption {
    if (!ciphertext) {
      this.removeRetainedBlob(slot)
      return { plaintext: '', status: 'decrypted' }
    }
    this.retainedBlobs.set(slot, ciphertext)
    this.keychainDeferredSlots.delete(slot)
    this.asyncDecryptedPlaintexts.delete(slot)
    if (!this.encryptionAvailable()) {
      this.sealedSlots.add(slot)
      return { plaintext: '', status: 'unavailable' }
    }
    try {
      const decrypted = {
        plaintext: safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
        status: 'decrypted' as const
      }
      this.sealedSlots.delete(slot)
      return decrypted
    } catch {
      return this.failDecryption(slot, ciphertext, isLegacyPlaintext)
    }
  }

  // Why (ORCA-1298): the sync decrypt and, on macOS, isEncryptionAvailable read the Keychain on
  // the main thread, so an unanswered prompt froze startup with no limit.
  async decryptWithStatusAsync(
    slot: string,
    ciphertext: string,
    isLegacyPlaintext?: LegacyPlaintextValidator,
    onLateDecrypt?: (decryption: ProtectedSecretDecryption) => void,
    timeoutMs = CREDENTIAL_KEYCHAIN_WAIT_MS
  ): Promise<ProtectedSecretDecryption> {
    if (!ciphertext) {
      return this.decryptWithStatus(slot, ciphertext)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), timeoutMs)
    })
    const read = decryptOffMainThread(Buffer.from(ciphertext, 'base64'))
    const outcome = await Promise.race([read, timedOut]).finally(() => clearTimeout(timer))
    // Why: on macOS the sync fallback would read the Keychain on the main thread, unbounded.
    if (
      process.platform !== 'darwin' &&
      (outcome === ASYNC_DECRYPT_UNAVAILABLE || outcome === ASYNC_DECRYPT_FAILED)
    ) {
      return this.decryptWithStatus(slot, ciphertext, isLegacyPlaintext)
    }
    this.retainedBlobs.set(slot, ciphertext)
    if (outcome === ASYNC_DECRYPT_UNAVAILABLE) {
      this.sealedSlots.add(slot)
      this.keychainDeferredSlots.add(slot)
      return { plaintext: '', status: 'unavailable' }
    }
    if (outcome === 'timed-out') {
      this.sealedSlots.add(slot)
      this.keychainDeferredSlots.add(slot)
      this.pendingKeychainSlots.add(slot)
      // Why: a prompt answered after the bound must still unseal the value for this session.
      void read.then((late) => this.settleLateDecrypt(slot, ciphertext, late, onLateDecrypt))
      console.warn(
        '[persistence] Keychain did not answer in time; retaining the protected value without exposing it.'
      )
      return { plaintext: '', status: 'failed' }
    }
    if (outcome === ASYNC_DECRYPT_FAILED) {
      const failed = this.failDecryption(slot, ciphertext, isLegacyPlaintext)
      if (this.sealedSlots.has(slot)) {
        this.keychainDeferredSlots.add(slot)
      }
      return failed
    }
    this.sealedSlots.delete(slot)
    this.keychainDeferredSlots.delete(slot)
    this.asyncDecryptedPlaintexts.set(slot, outcome)
    return { plaintext: outcome, status: 'decrypted' }
  }

  private settleLateDecrypt(
    slot: string,
    ciphertext: string,
    late: Awaited<ReturnType<typeof decryptOffMainThread>>,
    onLateDecrypt?: (decryption: ProtectedSecretDecryption) => void
  ): void {
    // Why: a save or clear since the timeout replaced this blob, so its late plaintext is stale.
    if (!this.pendingKeychainSlots.delete(slot) || this.retainedBlobs.get(slot) !== ciphertext) {
      return
    }
    if (typeof late !== 'string') {
      return
    }
    this.sealedSlots.delete(slot)
    this.keychainDeferredSlots.delete(slot)
    this.asyncDecryptedPlaintexts.set(slot, late)
    onLateDecrypt?.({ plaintext: late, status: 'decrypted' })
  }

  private failDecryption(
    slot: string,
    ciphertext: string,
    isLegacyPlaintext?: LegacyPlaintextValidator
  ): ProtectedSecretDecryption {
    if (isLegacyPlaintext?.(ciphertext)) {
      this.sealedSlots.delete(slot)
      console.warn('[persistence] safeStorage decryption failed; accepting legacy plaintext.')
      return { plaintext: ciphertext, status: 'failed' }
    }
    this.sealedSlots.add(slot)
    console.warn(
      '[persistence] safeStorage decryption failed; retaining the protected value without exposing it.'
    )
    return { plaintext: '', status: 'failed' }
  }

  private encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch (err) {
      console.warn('[persistence] safeStorage availability check failed:', err)
      return false
    }
  }
}
