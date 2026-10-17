import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { ORCA_GAME_SCENES_SKILL_NAME } from './agent-feature-install-commands'
import type { SkillUsageExample } from './skill-usage-example'

const ORCA_GAME_SCENES_SLASH_COMMAND = `/${ORCA_GAME_SCENES_SKILL_NAME}`

export const getOrcaGameScenesUsageExamples = createLocalizedCatalog((): SkillUsageExample[] => [
  {
    id: 'new-scene',
    title: translate('auto.lib.orcaGameScenes.usage.examples.newScene', 'Make a new scene'),
    summary: translate(
      'auto.lib.orcaGameScenes.usage.examples.newSceneSummary',
      'Start from the template, draw every phase and validate it until it is clean.'
    ),
    prompt: translate(
      'auto.lib.orcaGameScenes.usage.examples.newScenePrompt',
      'Use {{value0}} to make a Super Smash Bros scene for this project and turn it on.',
      { value0: ORCA_GAME_SCENES_SLASH_COMMAND }
    )
  },
  {
    id: 'change-colors',
    title: translate('auto.lib.orcaGameScenes.usage.examples.changeColors', 'Change the colors'),
    summary: translate(
      'auto.lib.orcaGameScenes.usage.examples.changeColorsSummary',
      'Restyle the sky, the world and the team band of the scene you already have.'
    ),
    prompt: translate(
      'auto.lib.orcaGameScenes.usage.examples.changeColorsPrompt',
      "Use {{value0}} to change the scene's colors to a sunset palette and validate it.",
      { value0: ORCA_GAME_SCENES_SLASH_COMMAND }
    )
  },
  {
    id: 'draws-quest',
    title: translate(
      'auto.lib.orcaGameScenes.usage.examples.drawsQuest',
      'Fix a scene that draws Quest'
    ),
    summary: translate(
      'auto.lib.orcaGameScenes.usage.examples.drawsQuestSummary',
      'Find why the game falls back to Quest and fix the file until it draws itself.'
    ),
    prompt: translate(
      'auto.lib.orcaGameScenes.usage.examples.drawsQuestPrompt',
      'My scene draws Quest instead of itself. Use {{value0}} to find out why and fix it.',
      { value0: ORCA_GAME_SCENES_SLASH_COMMAND }
    )
  }
])
