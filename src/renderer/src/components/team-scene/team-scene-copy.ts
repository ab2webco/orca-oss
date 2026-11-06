import { translate } from '@/i18n/i18n'
import type { TeamLeadCard } from '../../../../shared/team-panel-model-types'

/** The canvas is one image to assistive tech; this is its name. */
export const teamSceneLabel = (): string =>
  translate('auto.components.team-scene.team-scene-copy.label', 'Live team scene')

/**
 * The lead's bubble: its question behind a translated prefix, a tool step or link as written
 * (as the sidebar's agent rows show them), a translated line once done, else none.
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
  if (action?.kind === 'tool') {
    return action.detail ? `${action.tool}: ${action.detail}` : action.tool
  }
  if (action?.kind === 'link') {
    return `${action.name} ${action.id}`
  }
  return lead.status === 'done'
    ? translate('auto.components.team-scene.team-scene-copy.leadDone', 'Done, nothing pending')
    : null
}
