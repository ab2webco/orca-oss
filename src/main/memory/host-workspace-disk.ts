import { statfs as statfsOf } from 'node:fs/promises'
import path from 'node:path'

type DiskStats = { bsize: number; blocks: number; bavail: number }

/** Total and user-writable bytes on the disk holding `dir`; none when it cannot be read. */
export async function readWorkspaceDisk(
  dir: string,
  statfs: (at: string) => Promise<DiskStats> = statfsOf
): Promise<{ total: number; free: number } | null> {
  let at = dir
  for (;;) {
    try {
      const { bsize, blocks, bavail } = await statfs(at)
      const total = bsize * blocks
      return total > 0 ? { total, free: Math.min(total, bsize * bavail) } : null
    } catch (error) {
      // Why walk up: a fresh install has not made its workspaces folder yet, and its disk is the parent's.
      const parent = path.dirname(at)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === at) {
        return null
      }
      at = parent
    }
  }
}
