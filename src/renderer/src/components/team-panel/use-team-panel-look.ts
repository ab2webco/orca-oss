/** Same values as ORCA-1071's `orchestratorGame.panel.look`. */
export type TeamPanelLook = 'game' | 'display' | 'plain'

/** Game until ORCA-1071's look setting reaches this branch; then this reads it. */
export function useTeamPanelLook(): TeamPanelLook {
  return 'game'
}
