import type { RpcResponse } from '../transport/types'

export const WORKTREE_DELETE_FAILURE_TITLE = 'Could not delete worktree'
export const WORKTREE_DELETE_FAILURE_FALLBACK = 'Please try again.'

export type WorktreeDeleteOutcome = 'deleted' | 'refused' | 'failed'

export type WorktreeDeleteRequest = {
  sendRequest: (method: string, params?: unknown) => Promise<RpcResponse>
  worktreeId: string
  onRollback: () => void
  notifyFailure: (title: string, message: string) => void
}

/** Why: the route removes the row optimistically; a silent rollback looks like a delete that took. */
export async function runWorktreeDelete(
  request: WorktreeDeleteRequest
): Promise<WorktreeDeleteOutcome> {
  try {
    const response = await request.sendRequest('worktree.rm', {
      worktree: `id:${request.worktreeId}`,
      force: true
    })
    if (response.ok) {
      return 'deleted'
    }
    request.onRollback()
    request.notifyFailure(
      WORKTREE_DELETE_FAILURE_TITLE,
      response.error.message || WORKTREE_DELETE_FAILURE_FALLBACK
    )
    return 'refused'
  } catch {
    request.onRollback()
    request.notifyFailure(WORKTREE_DELETE_FAILURE_TITLE, WORKTREE_DELETE_FAILURE_FALLBACK)
    return 'failed'
  }
}
