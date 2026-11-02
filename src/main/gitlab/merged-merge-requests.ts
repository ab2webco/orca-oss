import type { IssueSourcePreference } from '../../shared/repo-types'
import {
  GAME_DELIVERY_PAGE_SIZE,
  gameDeliveryOf,
  type GameDelivery
} from '../../shared/orchestrator-game-delivery'
import {
  acquire,
  getGlabKnownHosts,
  glabApiWithHeaders,
  glabHostnameArgs,
  glabRepoExecOptions,
  parseGlabJsonList,
  release,
  resolveIssueSource,
  type LocalGitExecOptions
} from './gl-utils'
import { encodedProject } from './project-path-encoding'

/** The project's MRs merged since `since`, from the project My PRs lists; null off GitLab. */
export async function listMergedMergeRequestsSince(args: {
  repoPath: string
  since: string
  now: number
  preference?: IssueSourcePreference
  connectionId?: string | null
  localGitOptions?: LocalGitExecOptions
}): Promise<GameDelivery | null> {
  const { repoPath, connectionId, localGitOptions = {} } = args
  const hosts = await getGlabKnownHosts(connectionId, localGitOptions)
  const { source: ref } = await resolveIssueSource(
    repoPath,
    args.preference,
    hosts,
    connectionId,
    localGitOptions
  )
  if (!ref) {
    return null
  }
  // Why updated_after: GitLab cannot filter by merge time, and a merge always updates the MR.
  const path =
    `projects/${encodedProject(ref.path)}/merge_requests?state=merged` +
    `&updated_after=${encodeURIComponent(args.since)}&order_by=updated_at&sort=desc` +
    `&per_page=${GAME_DELIVERY_PAGE_SIZE}`
  const base = { provider: 'gitlab' as const, repo: ref.path, since: args.since, now: args.now }
  return gameDeliveryOf(base, async (page) => {
    await acquire()
    try {
      const { body, headers } = await glabApiWithHeaders(
        [...glabHostnameArgs(ref, connectionId), `${path}&page=${page}`],
        glabRepoExecOptions(repoPath, connectionId, localGitOptions)
      )
      const total = Number.parseInt(headers['x-total'] ?? '', 10)
      return {
        items: parseGlabJsonList<unknown>(body),
        total: Number.isFinite(total) ? total : null
      }
    } finally {
      release()
    }
  })
}
