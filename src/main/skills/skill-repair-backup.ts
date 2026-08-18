import { lstat, mkdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

export function canonicalSkillPath(home: string, name: string): string {
  return join(home, '.agents', 'skills', name)
}

/**
 * Points a provider home at the canonical copy, the layout `skills update --global`
 * converges. `skills add` does not do this itself: measured against the real CLI, an
 * `--agent <provider>` install writes a second real directory even when the canonical
 * copy exists, so without this link the repair reinstates the same unrecognized copy.
 *
 * Relative like the links the CLI's own multi-agent installs left behind, so the pair
 * survives a moved home. A junction on Windows, where a directory symlink needs rights
 * an ordinary user does not have.
 *
 * Yields to anything the installer put at the path rather than replacing it: an install
 * that wrote its own copy here has to reach the convergence check and be judged, not be
 * quietly overwritten with a link that makes any outcome look like the right one.
 */
export async function linkProviderAliasToCanonical(
  targetPath: string,
  canonicalPath: string
): Promise<void> {
  try {
    await lstat(targetPath)
    return
  } catch {
    // Nothing here, which is what the repair emptied it for.
  }
  const parent = dirname(targetPath)
  await mkdir(parent, { recursive: true })
  if (process.platform === 'win32') {
    await symlink(canonicalPath, targetPath, 'junction')
    return
  }
  // Why: a provider skills root is often itself a symlink, and the kernel resolves a
  // relative link against the physical directory — counting `../` from the logical path
  // walks off the filesystem root. Only this end needs resolving: the canonical stays as
  // written so the link keeps following whatever indirection the user put under `~`.
  await symlink(relative(await realpath(parent), canonicalPath), targetPath, 'dir')
}

/**
 * The canonical folder a repair would create, or null when the user already had one.
 * Called before the installer runs: a rollback may only remove what this run added.
 */
export async function pendingCanonicalCopy(home: string, name: string): Promise<string | null> {
  const canonicalPath = canonicalSkillPath(home, name)
  try {
    await lstat(canonicalPath)
    return null
  } catch {
    return canonicalPath
  }
}

/**
 * `home` is the user's home directory, never derived from the placement path: provider
 * roots nest at different depths (`~/.config/opencode/skills`, `~/.pi/agent/skills`), so
 * walking up a fixed number of segments scattered backups outside `~/.orca`.
 */
export async function collisionSafeBackupPath(
  home: string,
  targetPath: string,
  now: number,
  randomId: () => string
): Promise<string> {
  const parent = join(home, '.orca', 'skill-backups')
  const name = basename(targetPath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = join(parent, `${name}-${now}-${randomId()}`)
    try {
      await lstat(candidate)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return candidate
      }
      throw error
    }
  }
  throw new Error('Could not allocate a backup path')
}

/**
 * A half-finished install is worse than the copy we started from: a canonical folder the
 * user never had is exactly what the next scan reports as another unrecognized placement.
 * Undo it alongside the copy whenever the install did not converge.
 */
export async function restoreBackup(
  targetPath: string,
  backupPath: string,
  orphanCanonicalPath: string | null
): Promise<void> {
  await rm(targetPath, { recursive: true, force: true })
  if (orphanCanonicalPath && orphanCanonicalPath !== targetPath) {
    await rm(orphanCanonicalPath, { recursive: true, force: true })
  }
  await rename(backupPath, targetPath)
}
