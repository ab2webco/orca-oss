import { translate } from '@/i18n/i18n'

export type ToggleKey = 'band' | 'hud' | 'rewards' | 'tracker'

export const orchestratorGameSwitches = (): {
  key: ToggleKey
  label: string
  description: string
}[] => [
  {
    key: 'band',
    label: translate('auto.components.settings.OrchestratorGameSetting.band', 'Show the band'),
    description: translate(
      'auto.components.settings.OrchestratorGameSetting.bandDescription',
      'The pixel scene and HUD in Agent Teams panes.'
    )
  },
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

/** Where a switch sits: the band's own switch, what the band draws, or the game itself. */
export const switchPlaceOf = (key: ToggleKey): 'band' | 'drawn' | 'game' =>
  key === 'band' ? 'band' : key === 'hud' ? 'drawn' : 'game'
