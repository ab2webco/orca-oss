import { parseWorkspaceKey } from '../workspace-scope'
import { getWorktreePathBasenameFromId } from './id'

export const ORCA_WORKTREE_SLUG_ENV = 'ORCA_WORKTREE_SLUG'

const MAX_LABEL_LENGTH = 40

function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function slugLabel(worktreeId: string): string {
  if (parseWorkspaceKey(worktreeId)?.type === 'folder') {
    return 'folder'
  }
  const label = (getWorktreePathBasenameFromId(worktreeId) ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, MAX_LABEL_LENGTH)
    .replace(/^_+|_+$/g, '')
  return label || 'worktree'
}

/**
 * `[a-z0-9_]`, at most 49 chars, so projects can suffix databases, queues and
 * ports with it. Derived only from the worktree id so main, renderer and every
 * client of an SSH host agree; the hash keeps same-named dirs of other repos apart.
 */
export function worktreeSlugOf(worktreeId: string): string {
  return `${slugLabel(worktreeId)}_${fnv1a32Hex(worktreeId)}`
}

export function worktreeSlugEnv(worktreeId: string): Record<string, string> {
  return { [ORCA_WORKTREE_SLUG_ENV]: worktreeSlugOf(worktreeId) }
}
