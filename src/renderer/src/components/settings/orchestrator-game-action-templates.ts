import { translate } from '@/i18n/i18n'
import type { GameActionIcon } from '../../../../shared/orchestrator-game-actions'

export type GameActionTemplate = {
  label: string
  command: string
  icon: GameActionIcon
  prompt: string
}

/** V30's "Start with" chips, in the app language. */
export function gameActionTemplates(): GameActionTemplate[] {
  return [
    {
      label: translate('settings.gameActions.templates.deploy.label', 'Deploy'),
      command: translate('settings.gameActions.templates.deploy.command', 'deploy'),
      icon: 'ship',
      prompt: translate(
        'settings.gameActions.templates.deploy.prompt',
        'Deploy to staging and tell me the result.'
      )
    },
    {
      label: translate('settings.gameActions.templates.tests.label', 'Tests'),
      command: translate('settings.gameActions.templates.tests.command', 'tests'),
      icon: 'flask',
      prompt: translate(
        'settings.gameActions.templates.tests.prompt',
        'Run the whole suite and tell me only what failed.'
      )
    },
    {
      label: translate('settings.gameActions.templates.redPrs.label', 'Red PRs'),
      command: translate('settings.gameActions.templates.redPrs.command', 'red-prs'),
      icon: 'review',
      prompt: translate(
        'settings.gameActions.templates.redPrs.prompt',
        'Look at the red PRs and tell me which one needs a member.'
      )
    }
  ]
}
