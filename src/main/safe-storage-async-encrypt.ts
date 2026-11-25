import { safeStorage } from 'electron'

// Why (ORCA-1391): encryptString and, on macOS, isEncryptionAvailable read the Keychain on the
// main thread; the async pair reads it on a background thread and writes the same v10 blobs the
// sync decryptString reads. Null means no OS encryption, so callers keep their plaintext fallback.
export async function encryptSecretOffMainThread(plaintext: string): Promise<Buffer | null> {
  if (await asyncEncryptionAvailable()) {
    const blob = await safeStorage.encryptStringAsync(plaintext)
    if (syncDecryptReads(blob)) {
      return blob
    }
  }
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plaintext) : null
}

// Why (ORCA-1406): the async/sync round trip is proven live on macOS (Keychain) and on Linux with
// GNOME libsecret (Electron 43.8.6); KWallet and Windows DPAPI are unproven and keep the sync pair.
export function canEncryptOffMainThread(): boolean {
  if (
    typeof safeStorage.encryptStringAsync !== 'function' ||
    typeof safeStorage.isAsyncEncryptionAvailable !== 'function'
  ) {
    return false
  }
  if (process.platform === 'darwin') {
    return true
  }
  return (
    process.platform === 'linux' &&
    typeof safeStorage.getSelectedStorageBackend === 'function' &&
    safeStorage.getSelectedStorageBackend() === 'gnome_libsecret'
  )
}

// Why: with no keyring reachable, Linux's async encryptor still reports available and writes v10
// blobs that the sync decryptString refuses ("Decryption is not available"); only v11 is
// keyring-backed, so anything else goes back to the sync pair, which stores plaintext there.
function syncDecryptReads(blob: Buffer): boolean {
  return process.platform !== 'linux' || blob.subarray(0, 3).toString('latin1') === 'v11'
}

async function asyncEncryptionAvailable(): Promise<boolean> {
  return canEncryptOffMainThread() && safeStorage.isAsyncEncryptionAvailable().catch(() => false)
}

// Why: a save now awaits the encryptor, so a later save or delete of the same key must win.
export class LatestSecretWrites {
  private readonly generations = new Map<string, number>()
  private epoch = 0

  begin(key: string): () => boolean {
    this.supersede(key)
    return this.capture(key)
  }

  // Why: a save that runs in order behind earlier ones is cancelled only by a delete.
  capture(key: string): () => boolean {
    const generation = this.generations.get(key)
    const epoch = this.epoch
    return () => this.generations.get(key) === generation && this.epoch === epoch
  }

  supersede(key: string): number {
    const next = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, next)
    return next
  }

  supersedeAll(): void {
    this.epoch += 1
  }
}
