import type { OrchestratorGameState } from '../../../src/shared/orchestrator-game-state'
import type {
  TeamMachine,
  TeamMemberCard,
  TeamPrList,
  TeamQueueEntry,
  TeamSection
} from '../../../src/shared/team-panel-model-types'
import {
  teamMachinesSectionOf,
  teamPrSectionOf,
  teamQueueSectionOf
} from '../../../src/shared/team-panel-work-tabs'
import type { SupportedUiLocale } from '../../../src/shared/ui-locale'
import { teamWorkWordsOf } from './team-work-words'

/** A null section hides its tab. */
export type TeamSheetWork = {
  prs: TeamSection<TeamPrList> | null
  queue: TeamSection<TeamQueueEntry[]> | null
  machines: TeamSection<TeamMachine[]> | null
}

/** The PRs and Hosts tabs from the lead's game.state, built by the desktop panel's own builders. */
export function teamSheetWorkOf(
  state: Record<string, unknown>,
  members: readonly TeamMemberCard[],
  locale: SupportedUiLocale,
  now: number
): TeamSheetWork {
  const words = teamWorkWordsOf(locale)
  const work = {
    // Why no host `panel`: as on the desktop, its tab switches lag a toggle and belong to that window.
    state: { ...state, panel: undefined } as unknown as OrchestratorGameState,
    members,
    isFolder: false,
    texts: { providerFailed: words.providerFailed, githubLimit: words.githubLimit },
    now
  }
  return {
    prs: teamPrSectionOf(work),
    queue: teamQueueSectionOf(work),
    machines: teamMachinesSectionOf(work)
  }
}
