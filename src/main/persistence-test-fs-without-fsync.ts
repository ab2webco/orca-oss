import type * as NodeFs from 'node:fs'

/**
 * node:fs with fsyncSync as a no-op, for suites that test caps and retention, not durability.
 * Why: Store flushes with fsync on every mutation; on a spinning disk each costs ~70 ms, so a
 * 200-mutation loop outran the 30 s test budget on a developer's Linux host (ORCA-1407).
 */
export function fsWithoutFsync(actual: typeof NodeFs): typeof NodeFs {
  const patched = { ...actual, fsyncSync: (): void => {} }
  return { ...patched, default: patched } as typeof NodeFs
}
