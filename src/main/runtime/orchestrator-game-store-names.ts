import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Where a repo lives: its SSH connection (null on this machine) and its path there. */
export type GameRepoPlace = { connectionId: string | null; path: string }

/** How a store names a project's file; stores without one use the repo id's own name. */
export type GameStoreNaming = {
  nameIn: (dir: string, suffix: string, projectKey: string) => string
}

const hashOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32)

/**
 * Names each project's game files by its repo's connection and path, which a remove and re-add of
 * the repo keeps, instead of its repo id, which it does not (ORCA-1011). The runtime's project key
 * stays `repo:<id>`, so nothing a paired host reads changes.
 */
export class GameStoreNames implements GameStoreNaming {
  private readonly settled = new Set<string>()

  constructor(private readonly placeOf: (repoId: string) => GameRepoPlace | null) {}

  nameIn(dir: string, suffix: string, projectKey: string): string {
    const legacy = hashOf(projectKey)
    const repoId = projectKey.startsWith('repo:') ? projectKey.slice('repo:'.length) : null
    const place = repoId ? this.placeOf(repoId) : null
    // Why the id's name for a repo Orca no longer has: `game adopt-history` reads it there.
    if (!place) {
      return legacy
    }
    const path = place.path.replace(/[\\/]+$/, '')
    const stable = hashOf(`place:${place.connectionId ?? 'local'}:${path}`)
    const once = `${dir}\0${suffix}\0${stable}\0${legacy}`
    if (!this.settled.has(once)) {
      const from = join(dir, `${legacy}${suffix}`)
      const to = join(dir, `${stable}${suffix}`)
      try {
        // Why a copy: an older Orca on this host, after a downgrade, still reads the repo id's file.
        if (!existsSync(to) && existsSync(from)) {
          copyFileSync(from, to, constants.COPYFILE_EXCL)
        }
        this.settled.add(once)
      } catch (error) {
        // Why: EEXIST means another call copied it first; anything else is retried on the next read.
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          this.settled.add(once)
        }
      }
    }
    return stable
  }
}
