import { Crown, Info, Plus, RotateCcw, UserPlus } from 'lucide-react-native'
import type { ActionSheetAction, ActionSheetSection } from '../components/ActionSheetModal'
import type { AddMemberRoster } from './add-member-options'
import type { NewTabTeam } from './new-tab-team-read'
import type { TeamLeadReopen } from './new-tab-team-reopen'

type LiveLead = Extract<NewTabTeam, { kind: 'lead-live' }>['lead']

const noop = (): void => {}

type TeamActionArgs = {
  hostName: string
  onGoToLead: (lead: LiveLead) => void
  onReopen: () => void
  onAddMember: (roster: AddMemberRoster) => void
  onStartFresh: () => void
}

function addMemberActionOf(
  roster: AddMemberRoster | null,
  onAddMember: TeamActionArgs['onAddMember']
): ActionSheetAction {
  const count = roster?.todo.length ?? 0
  return {
    label: 'Add member…',
    hint: !roster ? 'Could not read To Do' : count > 0 ? `${count} in To Do` : 'To Do is empty',
    icon: UserPlus,
    disabled: count === 0,
    closeBeforePress: true,
    onPress: () => roster && onAddMember(roster)
  }
}

const startFreshActionOf = (onStartFresh: () => void): ActionSheetAction => ({
  label: 'Start fresh lead…',
  icon: Plus,
  closeBeforePress: true,
  onPress: onStartFresh
})

function teamActionsOf(team: NewTabTeam, args: TeamActionArgs): ActionSheetAction[] {
  switch (team.kind) {
    case 'unread':
      return []
    case 'none':
      return [startFreshActionOf(args.onStartFresh)]
    case 'unsupported':
      return [
        {
          label: `Update Orca on ${args.hostName} to use this`,
          icon: Info,
          disabled: true,
          onPress: noop
        }
      ]
    case 'pending':
      return [{ label: 'Go to lead', icon: Crown, disabled: true, loading: true, onPress: noop }]
    case 'lead-live':
      return [
        {
          label: 'Go to lead',
          hint: `Lead on ${args.hostName}`,
          icon: Crown,
          closeBeforePress: true,
          onPress: () => args.onGoToLead(team.lead)
        },
        addMemberActionOf(team.roster, args.onAddMember)
      ]
    case 'lead-closed':
      return [
        {
          label: 'Reopen team',
          hint: team.accountEmail ? `${team.accountEmail} on ${args.hostName}` : args.hostName,
          icon: RotateCcw,
          closeBeforePress: true,
          onPress: args.onReopen
        },
        startFreshActionOf(args.onStartFresh)
      ]
  }
}

/** The + sheet's Team group in the desktop's order; null keeps today's sheet. */
export function newTabTeamSectionOf(
  team: NewTabTeam,
  args: TeamActionArgs
): ActionSheetSection | null {
  const actions = teamActionsOf(team, args)
  return actions.length > 0 ? { title: 'Team', actions } : null
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
