import type { CommandHandler } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import {
  GAME_REPO_OUTSIDE_PROJECT,
  gameMemberRepoRefusalOf,
  type GameMemberRepoScopeRead
} from '../../shared/orchestrator-game-member-repo-scope'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { GameRemotePlacement } from './orchestrator-game-launch-options'

type Client = Parameters<CommandHandler>[0]['client']

// Why bounded: a paired host's repo read can stall behind a dead relay.
const REPO_SCOPE_TIMEOUT_MS = 45_000

/**
 * Refuses, before any name, task or worktree, a member whose `--repo` lies outside the lead's
 * project here or on a paired host (ORCA-1156). A member in the lead's own repo reads nothing.
 */
export async function checkGameMemberRepoScope(args: {
  client: Client
  state: OrchestratorGameState
  repo: string | null
  remote: GameRemotePlacement | null
}): Promise<void> {
  const selector = args.remote?.repo ?? args.repo
  if (selector === null) {
    return
  }
  const lead = args.state.worktree?.id
  if (!lead) {
    throw new RuntimeClientError(
      GAME_REPO_OUTSIDE_PROJECT,
      "Orca cannot tell this lead's project, so it launches no member with --repo."
    )
  }
  const params = {
    leadRepo: getRepoIdFromWorktreeId(lead),
    repo: selector,
    ...(args.remote ? { on: args.remote.on } : {})
  }
  const read = await args.client
    .call<GameMemberRepoScopeRead>('game.memberRepoScope', params, {
      timeoutMs: REPO_SCOPE_TIMEOUT_MS
    })
    .then(
      (response) => response.result,
      (error: unknown) => {
        // Why refuse: an Orca that cannot read the scope cannot keep a lead inside its project.
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            "The connected Orca Lab runtime cannot check a member's repo. Update or restart Orca Lab."
          )
        }
        throw error
      }
    )
  const refusal = gameMemberRepoRefusalOf({
    read,
    selector,
    memberRepos: args.state.lead?.memberRepos
  })
  if (refusal !== null) {
    throw new RuntimeClientError(GAME_REPO_OUTSIDE_PROJECT, refusal)
  }
}
