import { stat } from 'node:fs/promises'
import type { IGitProvider } from '../providers/git-provider-contract'
import type { IFilesystemProvider } from '../providers/types'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { parseWslUncPath, toWindowsWslPath } from '../../shared/wsl-paths'
import { gitExecFileAsync } from './runner'

export const SHIPPED_PRE_COMMIT_HOOK_PATHS = [
  '.husky/pre-commit',
  'scripts/hooks/pre-commit',
  '.githooks/pre-commit',
  'hooks/pre-commit',
  '.git-hooks/pre-commit'
] as const

const HOOKS_PATH_CHECK_TIMEOUT_MS = 5000

export type WorktreeHooksPathProbe = {
  /** Raw stdout of `git rev-parse --git-path hooks` run in the worktree. */
  readHooksPath: () => Promise<string>
  pathExists: (path: string) => Promise<boolean>
}

export function resolveGitHooksDir(
  worktreePath: string,
  gitPathOutput: string,
  wslDistro?: string
): string {
  const hooksPath = gitPathOutput.trim()
  const distro = parseWslUncPath(worktreePath)?.distro ?? wslDistro
  if (hooksPath.startsWith('/') && distro) {
    return toWindowsWslPath(hooksPath, distro)
  }
  if (hooksPath.startsWith('/') || isWindowsAbsolutePathLike(hooksPath)) {
    return hooksPath
  }
  // Why: `--git-path` prints relative to the cwd; `--path-format=absolute` needs Git 2.31.
  return joinWorktreeRelativePath(worktreePath, hooksPath)
}

async function readHooksPathWarning(
  worktreePath: string,
  probe: WorktreeHooksPathProbe,
  setupWillRun: boolean
): Promise<string | undefined> {
  const reported = (await probe.readHooksPath()).trim()
  if (!reported) {
    return undefined
  }
  const hooksDir = resolveGitHooksDir(worktreePath, reported)
  if (await probe.pathExists(joinWorktreeRelativePath(hooksDir, 'pre-commit'))) {
    return undefined
  }
  const shipped: string[] = []
  for (const candidate of SHIPPED_PRE_COMMIT_HOOK_PATHS) {
    if (await probe.pathExists(joinWorktreeRelativePath(worktreePath, candidate))) {
      shipped.push(candidate)
    }
  }
  if (shipped.length === 0) {
    return undefined
  }
  const shippedList = shipped.map((path) => `"${path}"`).join(', ')
  const setupNote = setupWillRun ? ' The setup script may install the hooks.' : ''
  return `Commits in this worktree will skip the repo's pre-commit hook: Git's hooks directory "${reported}" has no pre-commit, but the repo ships ${shippedList}. Orca did not change core.hooksPath.${setupNote}`
}

/** Warns when Git would silently skip a pre-commit the repo ships; never throws. */
export async function findWorktreeHooksPathWarning(
  worktreePath: string,
  probe: WorktreeHooksPathProbe,
  options: { setupWillRun?: boolean; timeoutMs?: number } = {}
): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), options.timeoutMs ?? HOOKS_PATH_CHECK_TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      readHooksPathWarning(worktreePath, probe, options.setupWillRun === true),
      timeout
    ])
  } catch (error) {
    console.warn(`[worktree-create] hooks path check skipped for ${worktreePath}:`, error)
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export function createLocalWorktreeHooksPathProbe(
  worktreePath: string,
  gitOptions: { wslDistro?: string }
): WorktreeHooksPathProbe {
  return {
    readHooksPath: async () => {
      const { stdout } = await gitExecFileAsync(['rev-parse', '--git-path', 'hooks'], {
        cwd: worktreePath,
        timeout: HOOKS_PATH_CHECK_TIMEOUT_MS,
        ...gitOptions
      })
      const reported = stdout.trim()
      // Why: git inside WSL prints Linux paths that Node fs can only reach through UNC.
      return reported.startsWith('/')
        ? resolveGitHooksDir(worktreePath, reported, gitOptions.wslDistro)
        : reported
    },
    pathExists: async (path) => {
      try {
        await stat(path)
        return true
      } catch {
        return false
      }
    }
  }
}

export function createRemoteWorktreeHooksPathProbe(
  worktreePath: string,
  provider: Pick<IGitProvider, 'exec'>,
  fsProvider: Pick<IFilesystemProvider, 'stat'>
): WorktreeHooksPathProbe {
  return {
    readHooksPath: async () =>
      (
        await provider.exec(['rev-parse', '--git-path', 'hooks'], worktreePath, {
          timeoutMs: HOOKS_PATH_CHECK_TIMEOUT_MS
        })
      ).stdout,
    pathExists: async (path) => {
      try {
        await fsProvider.stat(path)
        return true
      } catch {
        return false
      }
    }
  }
}
