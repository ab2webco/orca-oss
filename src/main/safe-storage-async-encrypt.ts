import { safeStorage } from 'electron'

// Why (ORCA-1391): encryptString and, on macOS, isEncryptionAvailable read the Keychain on the
// main thread; the async pair reads it on a background thread and writes the same v10 blobs the
// sync decryptString reads. Null means no OS encryption, so callers keep their plaintext fallback.
export async function encryptSecretOffMainThread(plaintext: string): Promise<Buffer | null> {
  if (await asyncEncryptionAvailable()) {
    return safeStorage.encryptStringAsync(plaintext)
  }
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plaintext) : null
}

// Why: the async-to-sync round trip is proven live only on macOS, where the Keychain prompt froze
// Orca; Linux and Windows keep the sync pair until a live round trip there widens this gate.
export function canEncryptOffMainThread(): boolean {
  return (
    process.platform === 'darwin' &&
    typeof safeStorage.encryptStringAsync === 'function' &&
    typeof safeStorage.isAsyncEncryptionAvailable === 'function'
  )
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
