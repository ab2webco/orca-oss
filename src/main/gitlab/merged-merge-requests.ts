import type { IssueSourcePreference } from '../../shared/repo-types'
import {
  GAME_DELIVERY_PAGE_SIZE,
  gameDeliveryOf,
  gameMergedReviewsOfGitLab,
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

/** The project's MRs merged since `since`; null when the repo is not on a known GitLab host. */
export async function listMergedMergeRequestsSince(args: {
  repoPath: string
  since: string
  now: number
  preference?: IssueSourcePreference
  connectionId?: string | null
  localGitOptions?: LocalGitExecOptions
}): Promise<GameDelivery | null> {
  const { repoPath, connectionId, localGitOptions = {} } = args
  const knownHosts = await getGlabKnownHosts(connectionId, localGitOptions)
  const { source: projectRef } = await resolveIssueSource(
    repoPath,
    args.preference,
    knownHosts,
    connectionId,
    localGitOptions
  )
  if (!projectRef) {
    return null
  }
  // Why updated_after: GitLab cannot filter by merge time, and a merge always updates the MR.
  const path =
    `projects/${encodedProject(projectRef.path)}/merge_requests?state=merged` +
    `&updated_after=${encodeURIComponent(args.since)}&order_by=updated_at&sort=desc` +
    `&per_page=${GAME_DELIVERY_PAGE_SIZE}`
  return gameDeliveryOf({
    provider: 'gitlab',
    repo: projectRef.path,
    since: args.since,
    now: args.now,
    readPage: async (page) => {
      await acquire()
      try {
        const { body, headers } = await glabApiWithHeaders(
          [...glabHostnameArgs(projectRef, connectionId), `${path}&page=${page}`],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        const total = Number.parseInt(headers['x-total'] ?? '', 10)
        return {
          reviews: gameMergedReviewsOfGitLab(parseGlabJsonList<unknown>(body)),
          total: Number.isFinite(total) ? total : null
        }
      } finally {
        release()
      }
    }
  })
}
