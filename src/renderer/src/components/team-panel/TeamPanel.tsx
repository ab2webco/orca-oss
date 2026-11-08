import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { openGamePanelSettings } from '@/components/settings/game-panel-settings-link'
import { useAppStore } from '@/store'
import { TeamActionDockConnected } from './TeamActionDockConnected'
import { TeamPanelView } from './TeamPanelView'
import { teamPanelModelWithSettings } from './team-panel-model-settings'
import { useTeamPanelModel } from './use-team-panel-model'
import { useTeamPanelSettings } from './use-team-panel-look'

export default function TeamPanel(): React.JSX.Element {
  // Why: the right sidebar is memoized, so its copy follows a language switch only through this.
  useTranslation()
  const read = useTeamPanelModel()
  const panel = useTeamPanelSettings()
  const pluginsOn = useAppStore((s) => s.settings?.pluginSystemEnabled === true)
  const source = useMemo(
    () =>
      read.section.kind === 'ready'
        ? {
            ...read,
            section: {
              kind: 'ready' as const,
              value: teamPanelModelWithSettings(read.section.value, { ...panel, pluginsOn })
            }
          }
        : read,
    [read, panel, pluginsOn]
  )
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettings = (repoId: string | null): void =>
    openGamePanelSettings({ openSettingsTarget, openSettingsPage }, repoId)
  return (
    <TeamPanelView
      source={source}
      look={panel.look}
      onOpenSettings={openSettings}
      dock={(model) => <TeamActionDockConnected model={model} onOpenSettings={openSettings} />}
    />
  )
}
