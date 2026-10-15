import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  composeTerminalPaneActionsPosition,
  resolveTerminalPaneActionsPosition,
  splitTerminalPaneActionsPosition,
  type TerminalPaneActionsAlign,
  type TerminalPaneActionsEdge
} from '../../../../shared/terminal-pane-actions-position'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

type TerminalPaneActionsPositionSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function TerminalPaneActionsPositionSetting({
  settings,
  updateSettings
}: TerminalPaneActionsPositionSettingProps): React.JSX.Element {
  const { edge, align } = splitTerminalPaneActionsPosition(
    resolveTerminalPaneActionsPosition(settings.terminalPaneActionsPosition)
  )
  const title = translate(
    'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.title',
    'Pane Actions Position'
  )

  return (
    <SearchableSetting
      title={title}
      description={translate(
        'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.description',
        'Where the split, close and agent buttons float on a pane without a title.'
      )}
      keywords={['pane', 'actions', 'buttons', 'position', 'split', 'close']}
    >
      <SettingsRow
        label={title}
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SettingsSegmentedControl<TerminalPaneActionsEdge>
              ariaLabel={translate(
                'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.edge',
                'Pane actions edge'
              )}
              value={edge}
              onChange={(next) =>
                updateSettings({
                  terminalPaneActionsPosition: composeTerminalPaneActionsPosition(next, align)
                })
              }
              options={[
                {
                  value: 'top',
                  label: translate(
                    'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.top',
                    'Top'
                  )
                },
                {
                  value: 'bottom',
                  label: translate(
                    'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.bottom',
                    'Bottom'
                  )
                }
              ]}
            />
            <SettingsSegmentedControl<TerminalPaneActionsAlign>
              ariaLabel={translate(
                'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.align',
                'Pane actions alignment'
              )}
              value={align}
              onChange={(next) =>
                updateSettings({
                  terminalPaneActionsPosition: composeTerminalPaneActionsPosition(edge, next)
                })
              }
              options={[
                {
                  value: 'left',
                  label: translate(
                    'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.left',
                    'Left'
                  )
                },
                {
                  value: 'center',
                  label: translate(
                    'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.center',
                    'Center'
                  )
                },
                {
                  value: 'right',
                  label: translate(
                    'auto.components.settings.TerminalAppearanceSection.paneActionsPosition.right',
                    'Right'
                  )
                }
              ]}
            />
          </div>
        }
      />
    </SearchableSetting>
  )
}
