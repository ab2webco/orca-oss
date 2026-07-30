import { z } from 'zod'
import { OptionalString } from '../schemas'
import type { TaskSourceContextSchema } from '../../../../shared/task-source-context-schema'
import type { WorkspaceLinkedItemSchema } from '../../../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../../../shared/workspace-linked-item-source-context'

// Why: mirrors the linkedLinearIssue link slot for Plane. Nullable so a meta
// update can clear it; optional so legacy clients that never send it are fine.
export const LinkedPlaneWorkItemSchema = z
  .object({
    identifier: z.string().min(1),
    projectId: z.string().min(1),
    workspaceId: OptionalString,
    url: OptionalString
  })
  .nullable()
  .optional()

/** Shared by WorktreeCreate and WorktreeSet so the two error messages cannot drift. */
export function assertLinkedWorkItemSourceContextMatch(
  params: {
    linkedWorkItem?: z.infer<typeof WorkspaceLinkedItemSchema> | null
    linkedTaskSourceContext?: z.infer<typeof TaskSourceContextSchema> | null
  },
  ctx: z.RefinementCtx
): void {
  if (
    params.linkedWorkItem &&
    params.linkedTaskSourceContext &&
    !isWorkspaceLinkedItemSourceContextMatch(params.linkedWorkItem, params.linkedTaskSourceContext)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Linked work item and source context identities must match'
    })
  }
}
