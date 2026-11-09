import { readFile, realpath, stat } from 'node:fs/promises'
import path, { posix, win32 } from 'node:path'
import { isWindowsAbsolutePathLike } from '../shared/cross-platform-path'
import { ORCHESTRATOR_GAME_SCENE_MAX_BYTES } from '../shared/orchestrator-game-scene'
import { parseOrchestratorGameSceneFile } from '../shared/orchestrator-game-scene-file'
import {
  ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES,
  ORCHESTRATOR_GAME_SCENE_ART_TOO_LARGE
} from '../shared/orchestrator-game-scene-native'
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

/** One image of a scene's art, as the host that owns it read it. */
export type GameSceneArtImage = { contentBase64: string; mimeType: 'image/png' | 'image/webp' }

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]

function imageMimeOf(bytes: Uint8Array): GameSceneArtImage['mimeType'] | null {
  if (PNG_MAGIC.every((byte, at) => bytes[at] === byte)) {
    return 'image/png'
  }
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...bytes.subarray(from, to))
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp' : null
}

/** `src` relative to the scene file's folder, checked the way `orca game scene validate` checks it. */
function sceneArtPathOf(sceneFile: string, src: string): string {
  const parsed = parseOrchestratorGameSceneFile(src)
  if (!parsed.ok || !/\.(png|webp)$/i.test(parsed.path)) {
    throw new GameSceneFileReadError('is not an image path inside the scene folder')
  }
  return posix.join(posix.dirname(sceneFile), parsed.path)
}

async function readLocalArt(sceneFolder: string, file: string): Promise<Uint8Array> {
  const [root, target] = await Promise.all([realpath(sceneFolder), realpath(file)])
  // Why the scene folder, not the worktree: validate contains art there, and the host serves it.
  if (!isInside(root, target, path)) {
    throw new GameSceneFileReadError('resolves outside the scene folder')
  }
  const info = await stat(target)
  if (!info.isFile()) {
    throw new GameSceneFileReadError('is not a file')
  }
  if (info.size > ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES) {
    throw new GameSceneFileReadError(ORCHESTRATOR_GAME_SCENE_ART_TOO_LARGE)
  }
  return readFile(target)
}

async function readRemoteArt(
  connectionId: string,
  sceneFolder: string,
  file: string
): Promise<Uint8Array> {
  const filesystem = getSshFilesystemProvider(connectionId)
  if (!filesystem) {
    throw new GameSceneFileReadError('the SSH host is not connected')
  }
  const [root, target] = await Promise.all([
    filesystem.realpath(sceneFolder),
    filesystem.realpath(file)
  ])
  if (!isInside(root, target, isWindowsAbsolutePathLike(root) ? win32 : posix)) {
    throw new GameSceneFileReadError('resolves outside the scene folder')
  }
  if ((await filesystem.stat(target)).size > ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES) {
    throw new GameSceneFileReadError(ORCHESTRATOR_GAME_SCENE_ART_TOO_LARGE)
  }
  const result = await filesystem.readFile(target, {
    maxBinaryBytes: ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES
  })
  // Why: the host sends binary files as base64 and an empty body when it would not preview them.
  if (!result.isBinary || result.content === '') {
    throw new GameSceneFileReadError('is not a PNG or WebP image')
  }
  return Buffer.from(result.content, 'base64')
}

/** Reads one image a worktree's scene file names, contained to that file's folder. */
export async function readWorktreeGameSceneArt(
  worktreePath: string,
  connectionId: string | null | undefined,
  sceneFile: string,
  src: string
): Promise<GameSceneArtImage> {
  try {
    const art = sceneArtPathOf(sceneFile, src)
    const folder = joinWorktreeRelativePath(worktreePath, posix.dirname(sceneFile))
    const file = joinWorktreeRelativePath(worktreePath, art)
    const bytes = connectionId
      ? await readRemoteArt(connectionId, folder, file)
      : await readLocalArt(folder, file)
    const mimeType = imageMimeOf(bytes)
    if (!mimeType) {
      throw new GameSceneFileReadError('is not a PNG or WebP image')
    }
    return { contentBase64: Buffer.from(bytes).toString('base64'), mimeType }
  } catch (error) {
    throw readErrorOf(error)
  }
}
