import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import type { Repo } from '../../../../shared/repo-types'
import { projectGameRowFactsOf } from './orchestrator-game-row-visibility'
import { useAdvisorPluginPresence } from './use-advisor-plugin-presence'

/** The project's game row facts for search, knowing whether the Advisor plugin is installed. */
export function useProjectGameRowFacts(
  repo: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>,
  settings: Parameters<typeof projectGameRowFactsOf>[0],
  project: OrchestratorGameLayer | undefined
): ReturnType<typeof projectGameRowFactsOf> {
  return projectGameRowFactsOf(settings, repo.id, project, useAdvisorPluginPresence(repo))
}
