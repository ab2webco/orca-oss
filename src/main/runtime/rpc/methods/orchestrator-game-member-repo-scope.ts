import { z } from 'zod'
import type {
  GameMemberRepoScopeRead,
  GameRepoSummary
} from '../../../../shared/orchestrator-game-member-repo-scope'
import type { Repo } from '../../../../shared/repo-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString, requiredString } from '../schemas'

const GameMemberRepoScopeParams = z.object({
  leadRepo: requiredString('Missing leadRepo'),
  repo: requiredString('Missing repo'),
  on: OptionalString
})

type RepoRecord = Pick<Repo, 'id' | 'displayName' | 'path' | 'gitRemoteIdentity'>

const REMOTE_TIMEOUT_MS = 30_000

const summaryOf = (repo: RepoRecord): GameRepoSummary => ({
  id: repo.id,
  displayName: repo.displayName,
  path: repo.path,
  remoteKey: repo.gitRemoteIdentity?.canonicalKey ?? null
})

const shownOn = async (show: () => Promise<RepoRecord>): Promise<GameRepoSummary | null> =>
  await show().then(summaryOf, () => null)

async function hostRead(
  runtime: OrcaRuntimeService,
  on: string,
  selector: string
): Promise<Pick<GameMemberRepoScopeRead, 'host' | 'repo' | 'repos'>> {
  const server = runtime.resolveOrchestrationWorkerServer(on)
  const call = async (method: string, params?: unknown): Promise<unknown> =>
    await runtime.callOrchestrationWorkerServer(
      server.environmentId,
      method,
      params,
      REMOTE_TIMEOUT_MS
    )
  // Why repo.list and repo.show: every host answers both, so no host needs this Orca's version.
  const listed = (await call('repo.list')) as { repos: RepoRecord[] }
  const repo = await shownOn(
    async () => ((await call('repo.show', { repo: selector })) as { repo: RepoRecord }).repo
  )
  return { host: server.name, repo, repos: listed.repos.map(summaryOf) }
}

/** The lead's repo and the one a member's `--repo` names, read where the member would run (ORCA-1156). */
export const ORCHESTRATOR_GAME_MEMBER_REPO_SCOPE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.memberRepoScope',
    params: GameMemberRepoScopeParams,
    handler: async (params, { runtime }): Promise<GameMemberRepoScopeRead> => {
      const lead = await shownOn(async () => await runtime.showRepo(`id:${params.leadRepo}`))
      if (params.on) {
        return { lead, ...(await hostRead(runtime, params.on, params.repo)) }
      }
      const repo = await shownOn(async () => await runtime.showRepo(params.repo))
      return { host: null, lead, repo, repos: [] }
    }
  })
]
