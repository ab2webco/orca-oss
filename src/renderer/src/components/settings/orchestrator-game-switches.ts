import { translate } from '@/i18n/i18n'

export type ToggleKey = 'hud' | 'rewards' | 'tracker'

export const orchestratorGameSwitches = (): {
  key: ToggleKey
  label: string
  description: string
}[] => [
  {
    key: 'hud',
    label: translate('auto.components.settings.OrchestratorGameSetting.hud', 'Teammate HUD'),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.hudDescription',
      "Show the fleet band above Claude's prompt."
    )
  },
  {
    key: 'rewards',
    label: translate('auto.components.settings.OrchestratorGameSetting.rewards', 'Rewards'),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.rewardsDescription',
      'XP, level-ups and celebrations when reviews merge or CI turns green.'
    )
  },
  {
    key: 'tracker',
    label: translate(
      'auto.components.settings.OrchestratorGameSetting.tracker',
      'Work item tracking'
    ),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.trackerDescription',
      'Follow the linked Plane, Jira, Linear, GitHub or GitLab item in the flow.'
    )
  }
]

/** The switch that draws in the terminal band, so it sits in that group. */
export const isBandToggle = (key: ToggleKey): boolean => key === 'hud'
