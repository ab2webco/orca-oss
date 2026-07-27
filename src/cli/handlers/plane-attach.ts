import { resolve } from 'node:path'
import type {
  PlaneLinkMutationResult,
  PlaneMutationResult,
  PlaneWorkItemLink
} from '../../shared/plane-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import {
  resolvePlaneWriteTarget,
  throwOnPlaneMutationFailure,
  unwrapPlaneLinkMutation
} from '../plane-request-builders'
import { formatPlaneLinks } from '../plane-format'
import { RuntimeClientError } from '../runtime-client'

const PLANE_WRITE_TIMEOUT_MS = 75_000
// The three-step upload streams the binary to storage inside the runtime; QA
// videos take minutes, so the RPC waits longer than the normal write budget
// (main bounds the storage POST itself at 10 minutes).
const PLANE_UPLOAD_TIMEOUT_MS = 11 * 60_000

// Structural mirror of the main-side result (plane-work-item-attachments.ts);
// the CLI bundle never imports from src/main.
type PlaneWorkItemAttachmentRow = {
  id: string
  name: string
  size: number
  contentType: string
  isUploaded: boolean
}

type PlaneAttachmentUploadResult =
  | { ok: true; attachment: PlaneWorkItemAttachmentRow }
  | {
      ok: false
      error: string
      failedStep: 'validate' | 'upload-grant' | 'binary-upload' | 'confirm'
      unconfirmedAssetId?: string
    }

// Links and uploaded files are different Plane resources; listing them under
// separate labels keeps the reader from mistaking one for the other.
function formatPlaneAttachInventory(value: {
  links: PlaneWorkItemLink[]
  attachments: PlaneWorkItemAttachmentRow[]
}): string {
  const files =
    value.attachments.length === 0
      ? 'No uploaded files.'
      : value.attachments
          .map(
            (attachment) =>
              `${attachment.name.padEnd(28)} ${attachment.size} bytes  ${attachment.contentType}${
                attachment.id ? ` (${attachment.id})` : ''
              }${attachment.isUploaded ? '' : ' [unconfirmed]'}`
          )
          .join('\n')
  return `Links:\n${formatPlaneLinks(value.links)}\n\nUploaded files:\n${files}`
}

// URL links + file uploads on a work item, exposed as `plane attach` so it
// never collides with the worktree-linking `plane link`. Each command resolves
// the id/identifier to the work item UUID first (Plane's write routes 404 on
// identifiers). `attach add` registers a URL link; `attach upload` runs the
// three-step presigned file upload — different Plane resources on purpose.
export const PLANE_ATTACH_HANDLERS: Record<string, CommandHandler> = {
  'plane attach add': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const title = getOptionalStringFlag(ctx.flags, 'title')
    const response = await ctx.client.call<PlaneLinkMutationResult>(
      'plane.addWorkItemLink',
      {
        projectId: target.projectId,
        workItemId: target.workItemId,
        url: getRequiredStringFlag(ctx.flags, 'url'),
        title,
        workspaceId: target.workspaceId
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    const link = unwrapPlaneLinkMutation(response.result)
    printResult(
      { ...response, result: link },
      ctx.json,
      (value) => `Attached ${value.url} to ${target.workItemId}${value.id ? ` (${value.id})` : ''}.`
    )
  },
  'plane attach upload': async (ctx) => {
    // The runtime reads --file from its own filesystem; over a remote pairing
    // that is a different machine, so the upload would grab the wrong file.
    if (ctx.client.isRemote) {
      throw new RuntimeClientError(
        'invalid_argument',
        'plane attach upload is not supported over a remote pairing: --file is read on the machine running the Orca app, not where the CLI runs.'
      )
    }
    const target = await resolvePlaneWriteTarget(ctx)
    const filePath = resolve(ctx.cwd, getRequiredStringFlag(ctx.flags, 'file'))
    const response = await ctx.client.call<PlaneAttachmentUploadResult>(
      'plane.uploadWorkItemAttachment',
      {
        projectId: target.projectId,
        workItemId: target.workItemId,
        filePath,
        workspaceId: target.workspaceId
      },
      { timeoutMs: PLANE_UPLOAD_TIMEOUT_MS }
    )
    const result = response.result
    if (!result.ok) {
      throw new RuntimeClientError('plane_write_failed', result.error)
    }
    printResult(
      { ...response, result: result.attachment },
      ctx.json,
      (attachment) =>
        `Uploaded ${attachment.name} (${attachment.size} bytes, ${attachment.contentType}) to ${target.workItemId} (${attachment.id}).`
    )
  },
  'plane attach list': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const params = {
      projectId: target.projectId,
      workItemId: target.workItemId,
      workspaceId: target.workspaceId
    }
    const [linksResponse, attachmentsResponse] = await Promise.all([
      ctx.client.call<PlaneWorkItemLink[]>('plane.listWorkItemLinks', params),
      ctx.client.call<PlaneWorkItemAttachmentRow[]>('plane.listWorkItemAttachments', params)
    ])
    printResult(
      {
        ...linksResponse,
        result: { links: linksResponse.result, attachments: attachmentsResponse.result }
      },
      ctx.json,
      formatPlaneAttachInventory
    )
  },
  'plane attach remove': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const linkId = getRequiredStringFlag(ctx.flags, 'link')
    const response = await ctx.client.call<PlaneMutationResult>(
      'plane.deleteWorkItemLink',
      {
        projectId: target.projectId,
        workItemId: target.workItemId,
        linkId,
        workspaceId: target.workspaceId
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    throwOnPlaneMutationFailure(response.result)
    printResult(response, ctx.json, () => `Removed link ${linkId} from ${target.workItemId}.`)
  }
}
