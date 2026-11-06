import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { TeamPanelView, type TeamPanelSettingsTarget } from './TeamPanelView'
import { useTeamPanelModel } from './use-team-panel-model'
import { useTeamPanelLook } from './use-team-panel-look'

export default function TeamPanel(): React.JSX.Element {
  // Why: the right sidebar is memoized, so its copy follows a language switch only through this.
  useTranslation()
  const source = useTeamPanelModel()
  const look = useTeamPanelLook()
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettings = (target: TeamPanelSettingsTarget): void => {
    openSettingsTarget(target)
    openSettingsPage()
  }
  return <TeamPanelView source={source} look={look} onOpenSettings={openSettings} />
}
