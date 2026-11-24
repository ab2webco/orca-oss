import { boundCredentialKeychainWait } from './integration-credential-file'
import type { IntegrationCredentialService } from '../shared/integration-credential-errors'

export type PendingCredentialRead<T> = {
  load: () => Promise<T | null>
  // Runs only while this read is still the account's current one.
  commit: (value: T | null) => void
  // Runs only while current; throw to hand the error to every waiting caller.
  fail: (error: unknown) => T | null
  // What a read superseded by a save or delete resolves to.
  latest: () => T | null
}

// Why (ORCA-1298): concurrent reads of one account share one Keychain request, a read that
// outlives its caller's bound still fills the cache, and a save or delete meanwhile drops it.
export class PendingCredentialReads<T> {
  private readonly pending = new Map<string, Promise<T | null>>()

  constructor(private readonly service: IntegrationCredentialService) {}

  read(key: string, hooks: PendingCredentialRead<T>): Promise<T | null> {
    let read = this.pending.get(key)
    if (!read) {
      read = this.start(key, hooks)
      this.pending.set(key, read)
    }
    return boundCredentialKeychainWait(this.service, read)
  }

  forget(key: string): void {
    this.pending.delete(key)
  }

  clear(): void {
    this.pending.clear()
  }

  private start(key: string, hooks: PendingCredentialRead<T>): Promise<T | null> {
    const isCurrent = (): boolean => this.pending.get(key) === read
    const read: Promise<T | null> = hooks.load().then(
      (value) => {
        if (!isCurrent()) {
          return hooks.latest()
        }
        this.pending.delete(key)
        hooks.commit(value)
        return value
      },
      (error: unknown) => {
        if (!isCurrent()) {
          return hooks.latest()
        }
        this.pending.delete(key)
        return hooks.fail(error)
      }
    )
    return read
  }
}
