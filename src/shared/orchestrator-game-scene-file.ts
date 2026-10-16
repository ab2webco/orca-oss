/** A project's own Agent Teams game scene: a JSON file at a path relative to its worktree root. */

export type OrchestratorGameSceneFileError = 'not-a-path' | 'absolute' | 'outside'

// Why 'file': plugin keys always hold a dot, so this source can never collide with a plugin's.
export const ORCHESTRATOR_GAME_SCENE_FILE_SOURCE = 'file'
export const ORCHESTRATOR_GAME_SCENE_FILE_DIR = '.orca/scenes'
// Mirrors the mod's own cap on a `file:` scene id.
const MAX_PATH = 512
const ID_PREFIX = `${ORCHESTRATOR_GAME_SCENE_FILE_SOURCE}:`

const isAbsolute = (path: string): boolean => path.startsWith('/') || /^[a-zA-Z]:/.test(path)

const hasControl = (path: string): boolean =>
  [...path].some((one) => (one.codePointAt(0) ?? 0) <= 0x1f || one === '\u007f')

/** The canonical worktree path (forward slashes, no `.` or empty parts), or why it is refused. */
export function parseOrchestratorGameSceneFile(
  value: unknown
): { ok: true; path: string } | { ok: false; error: OrchestratorGameSceneFileError } {
  if (typeof value !== 'string' || hasControl(value) || value.length > MAX_PATH) {
    return { ok: false, error: 'not-a-path' }
  }
  const slashed = value.trim().replace(/\\/g, '/')
  if (isAbsolute(slashed)) {
    return { ok: false, error: 'absolute' }
  }
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.includes('..')) {
    return { ok: false, error: 'outside' }
  }
  return parts.length === 0
    ? { ok: false, error: 'not-a-path' }
    : { ok: true, path: parts.join('/') }
}

export function orchestratorGameSceneFileErrorText(error: OrchestratorGameSceneFileError): string {
  return {
    'not-a-path': 'must be a path to a JSON file inside the worktree',
    absolute: 'must be relative to the worktree root, not absolute',
    outside: 'must stay inside the worktree (no ..)'
  }[error]
}

export const orchestratorGameSceneFileId = (path: string): string => `${ID_PREFIX}${path}`

export const orchestratorGameSceneFileOfId = (id: string): string | null =>
  id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : null

const isWindowsRoot = (path: string): boolean => /^[a-zA-Z]:/.test(path) || path.startsWith('\\\\')

/** The worktree path of a file picked from disk, or null when it is not inside `root`. */
export function orchestratorGameSceneFileWithin(root: string, absolute: string): string | null {
  const caseless = isWindowsRoot(root)
  const fold = (path: string): string => {
    const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return caseless ? slashed.toLowerCase() : slashed
  }
  const base = `${fold(root)}/`
  if (!fold(absolute).startsWith(base)) {
    return null
  }
  const parsed = parseOrchestratorGameSceneFile(absolute.replace(/\\/g, '/').slice(base.length))
  return parsed.ok ? parsed.path : null
}

/** Where a copy of `sceneId` may go, first choice first; the caller takes the first that is free. */
export function orchestratorGameSceneFileCandidates(sceneId: string, count = 50): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `${ORCHESTRATOR_GAME_SCENE_FILE_DIR}/${sceneId}${index === 0 ? '' : `-${index + 1}`}.json`
  )
}
