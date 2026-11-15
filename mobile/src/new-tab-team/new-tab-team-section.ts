import { Crown, Info } from 'lucide-react-native'
import type { ActionSheetAction, ActionSheetSection } from '../components/ActionSheetModal'
import type { NewTabTeam } from './new-tab-team-read'

type LiveLead = Extract<NewTabTeam, { kind: 'lead-live' }>['lead']

const noop = (): void => {}

function teamActionOf(
  team: NewTabTeam,
  args: { hostName: string; onGoToLead: (lead: LiveLead) => void }
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
