import type { RuntimeWorktreeRecord } from '../../shared/runtime-types'
import { isRuntimePathAbsolute, relativePathInsideRoot } from '../../shared/cross-platform-path'
import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'

export async function getFileWorktreeSelector({
  flags,
  cwd,
  client
}: HandlerContext): Promise<string> {
  const worktree = flags.get('worktree')
  if (flags.has('worktree') && (typeof worktree !== 'string' || worktree.length === 0)) {
    throw new RuntimeClientError('invalid_argument', 'Missing value for --worktree.')
  }
  const explicit = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
  if (explicit) {
    return explicit
  }
  if (client.isRemote) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote file commands require --worktree because the client cwd cannot identify a server worktree.'
    )
  }
  return await resolveCurrentWorktreeSelector(cwd, client)
}

export async function resolveFilePath(
  ctx: HandlerContext,
  worktree: string,
  path: string,
  options: { allowRoot?: boolean } = {}
): Promise<string> {
  if (!isRuntimePathAbsolute(path)) {
    return path
  }
  // Why: only in-worktree absolute paths should be relativized here; outside paths must reach the runtime guard unchanged.
  const result = await ctx.client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
    worktree
  })
  const relativePath = relativePathInsideRoot(result.result.worktree.path, path)
  if (relativePath === '' && !options.allowRoot) {
    throw new RuntimeClientError(
      'invalid_argument',
      'The selected worktree root is a directory, not a file-open target.'
    )
  }
  return relativePath ?? path
}
