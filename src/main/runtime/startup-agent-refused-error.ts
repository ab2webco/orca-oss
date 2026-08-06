/**
 * A workspace create that finished but whose requested agent never started.
 *
 * Why a distinct error rather than a `warning` field: `worktree create --agent` used
 * to answer ok when the Claude live-PTY gate refused the launch, so the caller got a
 * workspace of bare shells and no agent (ORCA-190). It carries the created workspace
 * so a caller adopts it instead of creating a duplicate, and so the RPC layer can
 * consume the automation dispatch token rather than releasing it for retry.
 */
export type StartupAgentRefusedError = Error & {
  readonly createdWorktreeId: string
  readonly createdWorktreePath: string
  readonly startupAgent: string
}

export function createStartupAgentRefusedError(args: {
  startupAgent: string
  worktreeId: string
  worktreePath: string
  failure: unknown
}): StartupAgentRefusedError {
  const message = args.failure instanceof Error ? args.failure.message : String(args.failure)
  return Object.assign(
    new Error(
      `The ${args.startupAgent} agent could not start in the new workspace at ${args.worktreePath}: ${message} The workspace was created and still exists (id:${args.worktreeId}) — reuse it instead of creating another.`
    ),
    {
      createdWorktreeId: args.worktreeId,
      createdWorktreePath: args.worktreePath,
      startupAgent: args.startupAgent
    }
  )
}

export function isStartupAgentRefusedError(error: unknown): error is StartupAgentRefusedError {
  return (
    error instanceof Error &&
    typeof (error as Partial<StartupAgentRefusedError>).createdWorktreeId === 'string'
  )
}
