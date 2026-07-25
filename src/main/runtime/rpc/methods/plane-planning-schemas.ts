import { z } from 'zod'
import { OptionalString, requiredString } from '../schemas'

const PlanningKind = z.enum(['cycle', 'module'])

export const PlanningContainer = z.object({
  kind: PlanningKind,
  projectId: requiredString('Project is required'),
  workspaceId: OptionalString
})

export const PlanningWorkItems = PlanningContainer.extend({
  containerId: requiredString('Cycle or module ID is required')
})

export const AddPlanningWorkItems = PlanningWorkItems.extend({
  workItemIds: z.array(requiredString('Work item ID is required')).min(1)
})
