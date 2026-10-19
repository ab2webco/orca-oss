import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const INSTALL_PREFIX = 'orca-game-'
const TEMP_PREFIX = '.tmp-orca-game-'
// Why: another process may still be copying; only a temp dir this old is surely abandoned.
const STALE_TEMP_MS = 60 * 60_000

async function contentKeyOf(sourceDir: string): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile()) {
        // Why: separator-normalized so one tree hashes the same on every platform.
        hash.update(relative(sourceDir, path).split(sep).join('/'))
        hash.update('\0')
        hash.update(await readFile(path))
        hash.update('\0')
      }
    }
  }
  await walk(sourceDir)
  return hash.digest('hex').slice(0, 16)
}

async function pruneOlderCopies(installRoot: string, current: string): Promise<void> {
  const entries = await readdir(installRoot, { withFileTypes: true })
  const copies: { path: string; mtimeMs: number }[] = []
  for (const entry of entries) {
    const path = join(installRoot, entry.name)
    if (!entry.isDirectory() || path === current) {
      continue
    }
    const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: Number.NaN }))
    if (entry.name.startsWith(INSTALL_PREFIX)) {
      copies.push({ path, mtimeMs })
    } else if (entry.name.startsWith(TEMP_PREFIX) && Date.now() - mtimeMs > STALE_TEMP_MS) {
      await rm(path, { recursive: true, force: true })
    }
  }
  // Why: a Claude session surviving an app update in the daemon still reads the previous copy's skills.
  copies.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const { path } of copies.slice(1)) {
    await rm(path, { recursive: true, force: true })
  }
}

/** Copies the bundled plugin to a user-writable dir keyed by content; Claude Code writes into it. */
export async function installOrchestratorGamePlugin(args: {
  sourceDir: string
  installRoot: string
}): Promise<string> {
  const target = join(args.installRoot, `${INSTALL_PREFIX}${await contentKeyOf(args.sourceDir)}`)
  if (!existsSync(target)) {
    await mkdir(args.installRoot, { recursive: true })
    const temp = join(args.installRoot, `${TEMP_PREFIX}${randomUUID()}`)
    try {
      await cp(args.sourceDir, temp, { recursive: true })
      await rename(temp, target)
    } catch (error) {
      // Why: a concurrent install that renamed first is a success, whatever error the loser got.
      if (!existsSync(target)) {
        throw error
      }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
  await pruneOlderCopies(args.installRoot, target).catch(() => undefined)
  return target
}
