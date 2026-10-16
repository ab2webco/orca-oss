import { readFile, realpath, stat } from 'node:fs/promises'
import path, { posix, win32 } from 'node:path'
import { isWindowsAbsolutePathLike } from '../shared/cross-platform-path'
import { ORCHESTRATOR_GAME_SCENE_MAX_BYTES } from '../shared/orchestrator-game-scene'
import { getSshFilesystemProvider } from './providers/ssh-filesystem-dispatch'
import { joinWorktreeRelativePath } from './runtime/runtime-relative-paths'

/** Why a project's scene file could not be read, worded for the game's note. */
export class GameSceneFileReadError extends Error {}

const TOO_LARGE = `larger than ${ORCHESTRATOR_GAME_SCENE_MAX_BYTES / 1024} KB`

const isInside = (
  root: string,
  target: string,
  api: Pick<typeof posix, 'relative' | 'isAbsolute' | 'sep'>
): boolean => {
  const fromRoot = api.relative(root, target)
  return (
    fromRoot !== '' &&
    !api.isAbsolute(fromRoot) &&
    fromRoot !== '..' &&
    !fromRoot.startsWith(`..${api.sep}`)
  )
}

function readErrorOf(error: unknown): GameSceneFileReadError {
  if (error instanceof GameSceneFileReadError) {
    return error
  }
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new GameSceneFileReadError('not found')
  }
  return new GameSceneFileReadError(
    typeof code === 'string' ? `could not be read (${code})` : 'could not be read'
  )
}

async function readLocal(worktreePath: string, file: string): Promise<string> {
  const [root, target] = await Promise.all([realpath(worktreePath), realpath(file)])
  // Why: a link inside the repo must not hand the game a file from elsewhere on this machine.
  if (!isInside(root, target, path)) {
    throw new GameSceneFileReadError('resolves outside the worktree')
  }
  const info = await stat(target)
  if (!info.isFile()) {
    throw new GameSceneFileReadError('is not a file')
  }
  if (info.size > ORCHESTRATOR_GAME_SCENE_MAX_BYTES) {
    throw new GameSceneFileReadError(TOO_LARGE)
  }
  return readFile(target, 'utf8')
}

async function readRemote(
  connectionId: string,
  worktreePath: string,
  file: string
): Promise<string> {
  const filesystem = getSshFilesystemProvider(connectionId)
  if (!filesystem) {
    throw new GameSceneFileReadError('the SSH host is not connected')
  }
  const [root, target] = await Promise.all([
    filesystem.realpath(worktreePath),
    filesystem.realpath(file)
  ])
  if (!isInside(root, target, isWindowsAbsolutePathLike(root) ? win32 : posix)) {
    throw new GameSceneFileReadError('resolves outside the worktree')
  }
  const result = await filesystem.readFile(target, {
    maxTextBytes: ORCHESTRATOR_GAME_SCENE_MAX_BYTES
  })
  if (result.isBinary) {
    throw new GameSceneFileReadError('is not a text file')
  }
  if (Buffer.byteLength(result.content, 'utf8') > ORCHESTRATOR_GAME_SCENE_MAX_BYTES) {
    throw new GameSceneFileReadError(TOO_LARGE)
  }
  return result.content
}

/** Reads `relativePath` (already validated) from the worktree's own host; SSH reads the remote disk. */
export async function readWorktreeGameSceneFile(
  worktreePath: string,
  connectionId: string | null | undefined,
  relativePath: string
): Promise<string> {
  const file = joinWorktreeRelativePath(worktreePath, relativePath)
  try {
    return connectionId
      ? await readRemote(connectionId, worktreePath, file)
      : await readLocal(worktreePath, file)
  } catch (error) {
    throw readErrorOf(error)
  }
}
