import { translate } from '@/i18n/i18n'
import type { TeamLeadCard } from '../../../../shared/team-panel-model-types'
import { teamToolText } from '../team-panel/team-card-text'
import { isAskUserQuestionTool } from '../../../../shared/agent-question-answered-intent'

/** The canvas is one image to assistive tech; this is its name. */
export const teamSceneLabel = (): string =>
  translate('auto.components.team-scene.team-scene-copy.label', 'Live team scene')

/**
 * The lead's bubble: its question behind a translated prefix, what its tool works on or a link as written, a translated line once done, else none.
 */
export function teamSceneLeadLineOf(
  lead: Pick<TeamLeadCard, 'liveAction' | 'status'>
): string | null {
  const action = lead.liveAction
  if (action?.kind === 'question') {
    return translate(
      'auto.components.team-scene.team-scene-copy.leadAsks',
      'Waiting for you · {{question}}',
      {
        question: action.text
      }
    )
  }
  // Why: game.state names only the question tool; its words come from agent status, when known.
  if (action?.kind === 'tool' && isAskUserQuestionTool(action.tool)) {
    return translate('auto.components.team-scene.team-scene-copy.leadWaits', 'Waiting for you')
  }
  if (action?.kind === 'tool') {
    return teamToolText(action.tool, action.detail)
  }
  if (action?.kind === 'link') {
    return `${action.name} ${action.id}`
  }
  return lead.status === 'done'
    ? translate('auto.components.team-scene.team-scene-copy.leadDone', 'Done, nothing pending')
    : null
}
