import type { CrashReportBreadcrumbData } from '../../../../shared/crash-reporting'
import type { TeamLeadCaller, TeamLeadRoster } from './team-panel-lead-read'

/** Why a no-team view shows while the host lists a lead; it was silent before (ORCA-1402). */
type NoTeamReason = 'lead_unplaced' | 'state_not_lead' | 'state_without_leader'

export type TeamPanelNoTeamNotes = ReturnType<typeof createTeamPanelNoTeamNotes>

/** One breadcrumb per cause and scope, not one per 20 s poll; a team shown in between clears it. */
export function createTeamPanelNoTeamNotes(deps: {
  record: (name: string, data: CrashReportBreadcrumbData) => void
  /** Listed leads whose pane has no tab here. */
  countUnplaced: (roster: TeamLeadRoster) => number
}) {
  const noted = new Map<string, NoTeamReason>()
  return {
    read(
      scopeKey: string,
      read: { roster: TeamLeadRoster; caller: TeamLeadCaller | null; state: object | null }
    ): void {
      const reason: NoTeamReason = !read.caller
        ? 'lead_unplaced'
        : read.state
          ? 'state_without_leader'
          : 'state_not_lead'
      const leads = read.roster.leads.length
      const unplaced = deps.countUnplaced(read.roster)
      // Why: with every lead placed in another project, no team here is the plain answer.
      if (leads === 0 || (reason === 'lead_unplaced' && unplaced === 0)) {
        return
      }
      if (noted.get(scopeKey) !== reason) {
        noted.set(scopeKey, reason)
        deps.record('team_panel_no_team', { reason, leads, unplaced })
      }
    },
    clear(scopeKey: string): void {
      noted.delete(scopeKey)
    }
  }
}
