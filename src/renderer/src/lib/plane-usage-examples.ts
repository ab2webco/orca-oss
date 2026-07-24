import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { ORCA_PLANE_SKILL_NAME } from './agent-feature-install-commands'
import type { SkillUsageExample } from './skill-usage-example'

const PLANE_SLASH_COMMAND = `/${ORCA_PLANE_SKILL_NAME}`

export const getPlaneUsageExamples = createLocalizedCatalog((): SkillUsageExample[] => [
  {
    id: 'read-work-item',
    title: translate('auto.lib.plane.usage.examples.readWorkItem', 'Read the work item'),
    summary: translate(
      'auto.lib.plane.usage.examples.readWorkItemSummary',
      "Pull a Plane work item's full context before starting work."
    ),
    prompt: translate(
      'auto.lib.plane.usage.examples.readWorkItemPrompt',
      'Use {{value0}} to read the Plane work item for this task, then summarize the goal and acceptance criteria before you start.',
      { value0: PLANE_SLASH_COMMAND }
    )
  },
  {
    id: 'post-update',
    title: translate('auto.lib.plane.usage.examples.postUpdate', 'Post a progress update'),
    summary: translate(
      'auto.lib.plane.usage.examples.postUpdateSummary',
      'Comment progress or a completion summary back to the Plane work item.'
    ),
    prompt: translate(
      'auto.lib.plane.usage.examples.postUpdatePrompt',
      'Use {{value0}} to post a completion update on the Plane work item with what changed and how it was verified.',
      { value0: PLANE_SLASH_COMMAND }
    )
  },
  {
    id: 'move-state',
    title: translate('auto.lib.plane.usage.examples.moveState', 'Move the work item forward'),
    summary: translate(
      'auto.lib.plane.usage.examples.moveStateSummary',
      'Advance the Plane project state as the work progresses.'
    ),
    prompt: translate(
      'auto.lib.plane.usage.examples.moveStatePrompt',
      'Use {{value0}} to move the Plane work item to In Review now that the change is ready.',
      { value0: PLANE_SLASH_COMMAND }
    )
  },
  {
    id: 'triage',
    title: translate('auto.lib.plane.usage.examples.triage', 'Triage assignee and priority'),
    summary: translate(
      'auto.lib.plane.usage.examples.triageSummary',
      'Set the assignee and priority on a Plane work item.'
    ),
    prompt: translate(
      'auto.lib.plane.usage.examples.triagePrompt',
      'Use {{value0}} to assign the Plane work item to me and set its priority to high.',
      { value0: PLANE_SLASH_COMMAND }
    )
  }
])
