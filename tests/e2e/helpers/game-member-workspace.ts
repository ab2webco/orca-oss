import type { RuntimeClient } from '../../../src/cli/runtime-client'

/** The one line Orca types a game member; group 1 is its brief's path, relative to the member's cwd. */
export const BRIEF_LINE = /Read your Orca Lab brief at (\S+) \(task \S+\) and follow it\./

export type MemberDispatch = {
  id: string
  assignee_handle: string | null
  last_heartbeat_at: string | null
}

export async function memberDispatchOf(
  client: RuntimeClient,
  taskId: string
): Promise<MemberDispatch | null> {
  const shown = await client.call<{ dispatch: MemberDispatch | null }>(
    'orchestration.dispatchShow',
    { task: taskId }
  )
  return shown.result.dispatch
}

/** The workspace the member running a task's dispatch started in, where its brief is written. */
export async function memberWorkspaceOf(
  client: RuntimeClient,
  taskId: string
): Promise<string | null> {
  const handle = (await memberDispatchOf(client, taskId))?.assignee_handle
  if (!handle) {
    return null
  }
  const terminal = await client.call<{ terminal: { worktreeId: string } }>('terminal.show', {
    terminal: handle
  })
  const worktrees = await client.call<{ worktrees: { id: string; path: string }[] }>(
    'worktree.list',
    {}
  )
  return (
    worktrees.result.worktrees.find((one) => one.id === terminal.result.terminal.worktreeId)
      ?.path ?? null
  )
}
