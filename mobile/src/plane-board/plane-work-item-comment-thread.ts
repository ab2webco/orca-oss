import { z } from 'zod'
import type { RpcClient } from '../transport/rpc-client'

// Soft fields degrade to a default rather than dropping the comment: an author
// or a date the phone cannot read must not cost the reader the body.
const PlaneMobileCommentSchema = z
  .object({
    id: z.string().min(1),
    body: z.string().default(''),
    createdAt: z.string().default(''),
    user: z
      .object({ id: z.string().default(''), displayName: z.string().default('') })
      .passthrough()
      .nullish()
      .catch(null)
  })
  .passthrough()

// No .catch([]) on the array: a thread the phone cannot decode is a failed read, not an empty one.
const PlaneCommentThreadReadSchema = z.union([
  z.object({ ok: z.literal(true), comments: z.array(PlaneMobileCommentSchema) }),
  z.object({ ok: z.literal(false), error: z.string().default('') })
])

export type PlaneMobileComment = z.infer<typeof PlaneMobileCommentSchema>

export type PlaneCommentThreadResult =
  | { ok: true; comments: PlaneMobileComment[] }
  | { ok: false; error: string }

const UNREADABLE_MESSAGE = 'Could not read the comments'

/** Sends the literal method name so the mobile RPC allowlist test can see it. */
export async function readPlaneCommentThread(
  client: RpcClient,
  args: { projectId: string; workItemId: string; workspaceId: string | null }
): Promise<PlaneCommentThreadResult> {
  if (!args.projectId || !args.workItemId) {
    return { ok: false, error: UNREADABLE_MESSAGE }
  }
  let response
  try {
    response = await client.sendRequest('plane.readWorkItemCommentThread', {
      projectId: args.projectId,
      workItemId: args.workItemId,
      workspaceId: args.workspaceId ?? undefined
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : UNREADABLE_MESSAGE }
  }
  if (!response.ok) {
    return { ok: false, error: response.error.message || UNREADABLE_MESSAGE }
  }
  const read = PlaneCommentThreadReadSchema.safeParse(response.result)
  if (!read.success) {
    return { ok: false, error: UNREADABLE_MESSAGE }
  }
  return read.data.ok
    ? { ok: true, comments: read.data.comments }
    : { ok: false, error: read.data.error || UNREADABLE_MESSAGE }
}
