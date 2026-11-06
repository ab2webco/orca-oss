import { useTranslation } from 'react-i18next'
import { openGamePanelSettings } from '@/components/settings/game-panel-settings-link'
import { useAppStore } from '@/store'
import { TeamPanelView } from './TeamPanelView'
import { useTeamPanelModel } from './use-team-panel-model'
import { useTeamPanelLook } from './use-team-panel-look'

export default function TeamPanel(): React.JSX.Element {
  // Why: the right sidebar is memoized, so its copy follows a language switch only through this.
  useTranslation()
  const source = useTeamPanelModel()
  const look = useTeamPanelLook()
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettings = (repoId: string | null): void =>
    openGamePanelSettings({ openSettingsTarget, openSettingsPage }, repoId)
  return <TeamPanelView source={source} look={look} onOpenSettings={openSettings} />
}
