import { createContext, useContext } from 'react'
import type { TeamActivityRow, TeamStatus } from '../../../../shared/team-panel-model-types'

export type TeamActivityFilterState = {
  /** The count the person picked under "Your work"; null shows every session. */
  filter: TeamStatus | null
  setFilter: (filter: TeamStatus | null) => void
}

export const TeamActivityFilterContext = createContext<TeamActivityFilterState>({
  filter: null,
  setFilter: () => {}
})

export const useTeamActivityFilter = (): TeamActivityFilterState =>
  useContext(TeamActivityFilterContext)

export const teamActivityRowsOf = (
  rows: readonly TeamActivityRow[],
  filter: TeamStatus | null
): readonly TeamActivityRow[] => (filter ? rows.filter((row) => row.status === filter) : rows)
