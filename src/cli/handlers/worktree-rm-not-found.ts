import type { RuntimeClient } from '../runtime-client'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalStringFlag } from '../flags'

function describeHost(flags: Map<string, string | boolean>, client: RuntimeClient) {
  if (!client.isRemote) {
    return { on: '', list: 'orca worktree list' }
  }
  const environment = getOptionalStringFlag(flags, 'environment') ?? process.env.ORCA_ENVIRONMENT
  return environment
    ? { on: ` on ${environment}`, list: `orca worktree list --environment ${environment}` }
    : { on: ' on the paired host', list: 'orca worktree list with the same pairing code' }
}

/** Why (ORCA-866): a bare `selector_not_found` did not say which host was searched or that the tree may be gone. */
export function rethrowWorktreeRemovalNotFound(
  error: unknown,
  flags: Map<string, string | boolean>,
  client: RuntimeClient,
  selector: string
): never {
  if (!(error instanceof RuntimeClientError) || error.code !== 'selector_not_found') {
    throw error
  }
  const host = describeHost(flags, client)
  throw new RuntimeClientError(
    'selector_not_found',
    `No worktree${host.on} matches ${selector}; it may already be removed. List the worktrees there with: ${host.list}`
  )
}
