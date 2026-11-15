import { Crown, Info, RotateCcw } from 'lucide-react-native'
import type { ActionSheetAction, ActionSheetSection } from '../components/ActionSheetModal'
import type { NewTabTeam } from './new-tab-team-read'
import type { TeamLeadReopen } from './new-tab-team-reopen'

type LiveLead = Extract<NewTabTeam, { kind: 'lead-live' }>['lead']

const noop = (): void => {}

function teamActionOf(
  team: NewTabTeam,
  args: { hostName: string; onGoToLead: (lead: LiveLead) => void; onReopen: () => void }
): ActionSheetAction | null {
  switch (team.kind) {
    case 'none':
      return null
    case 'unsupported':
      return {
        label: `Update Orca on ${args.hostName} to use this`,
        icon: Info,
        disabled: true,
        onPress: noop
      }
    case 'pending':
      return { label: 'Go to lead', icon: Crown, disabled: true, loading: true, onPress: noop }
    case 'lead-live':
      return {
        label: 'Go to lead',
        hint: `Lead on ${args.hostName}`,
        icon: Crown,
        closeBeforePress: true,
        onPress: () => args.onGoToLead(team.lead)
      }
    case 'lead-closed':
      return {
        label: 'Reopen team',
        hint: team.accountEmail ? `${team.accountEmail} on ${args.hostName}` : args.hostName,
        icon: RotateCcw,
        closeBeforePress: true,
        onPress: args.onReopen
      }
  }
}

/** The + sheet's Team group in the desktop's order; null keeps today's sheet. */
export function newTabTeamSectionOf(
  team: NewTabTeam,
  args: Parameters<typeof teamActionOf>[1]
): ActionSheetSection | null {
  const action = teamActionOf(team, args)
  return action ? { title: 'Team', actions: [action] } : null
}

/** The desktop's Reopen team messages (ORCA-717); null when the lead came back. */
export function reopenFailureOf(answer: TeamLeadReopen): string | null {
  switch (answer.kind) {
    case 'lead':
      return null
    case 'failed':
      return `Could not reopen the team: ${answer.reason}`
    case 'nothing-kept':
      return 'No kept lead to reopen'
    case 'unsupported':
      return 'This host cannot reopen the team'
  }
}
