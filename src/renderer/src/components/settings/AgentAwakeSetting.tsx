import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  getAgentAwakeDescription,
  getAgentAwakeSearchKeywords,
  getAgentAwakeTitle
} from './agent-awake-copy'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import {
  computerAwakeSettingsForMode,
  normalizeComputerAwakeMode,
  type ComputerAwakeMode
} from '../../../../shared/computer-awake-mode'
import { translate } from '@/i18n/i18n'

type AgentAwakeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function AgentAwakeSetting({
  settings,
  updateSettings
}: AgentAwakeSettingProps): React.JSX.Element {
  const title = getAgentAwakeTitle()
  const description = getAgentAwakeDescription()
  const mode = normalizeComputerAwakeMode(
    settings.computerAwakeMode,
    settings.keepComputerAwakeWhileAgentsRun
  )
  const setMode = (nextMode: ComputerAwakeMode): void => {
    updateSettings(computerAwakeSettingsForMode(nextMode))
  }

  return (
    <section className="space-y-3">
      <SearchableSetting
        title={title}
        description={description}
        keywords={getAgentAwakeSearchKeywords()}
      >
        <SettingsRow
          label={title}
          description={description}
          alignTop
          className="py-2"
          control={
            <SettingsSegmentedControl
              value={mode}
              onChange={setMode}
              ariaLabel={title}
              size="sm"
              options={[
                {
                  value: 'on',
                  label: translate('auto.components.settings.AgentAwakeSetting.on', 'On')
                },
                {
                  value: 'auto',
                  label: translate('auto.components.settings.AgentAwakeSetting.auto', 'Agent')
                },
                {
                  value: 'off',
                  label: translate('auto.components.settings.AgentAwakeSetting.off', 'Off')
                }
              ]}
            />
          }
        />
      </SearchableSetting>
    </section>
  )
}
