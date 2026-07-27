// Plane work-item file attachments: the three-step presigned upload flow plus
// the attachment list. Distinct from plane-work-item-links.ts (URL links): the
// upload lives on the `/attachments/` sub-route and returns its own metadata.
//
// Verified against a live Plane tenant (see ORCA-54): step 1 POSTs
// {name, type, size} and answers {upload_data: {url, fields}, asset_id, ...};
// step 2 is a presigned S3 *POST* (multipart form, `file` field last), not a
// PUT; step 3 PATCHes the asset id to flip is_uploaded. Attachments exist only
// under the legacy-compatible `/attachments/` sub-route of work-items.
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeFetch,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import {
  boundedIntegrationErrorLog,
  boundedIntegrationErrorMessage
} from '../integration-error-message'
import { resolveClient, toMutationError, type PlaneRecord } from './plane-work-item-writes'
import { workItemsBase } from './work-items'
import type { PlaneWorkspaceSelection } from '../../shared/plane-types'

// Whole file is buffered in main-process memory to build the multipart body.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
// QA evidence can be multi-minute video uploads; the normal Plane API timeout
// budget does not apply to the storage POST, so it gets its own generous bound.
export const STORAGE_UPLOAD_TIMEOUT_MS = 10 * 60_000

const ATTACHMENT_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.zip': 'application/zip'
}

export type PlaneWorkItemAttachment = {
  id: string
  name: string
  size: number
  contentType: string
  isUploaded: boolean
}

// Which of the three steps failed, so callers can say exactly what state was
// left behind: validate/upload-grant → nothing happened; binary-upload → a
// grant was issued but no bytes landed; confirm → bytes are in storage but the
// asset is NOT attached (the worst case — the user cannot deduce it).
export type PlaneAttachmentUploadFailedStep =
  | 'validate'
  | 'upload-grant'
  | 'binary-upload'
  | 'confirm'

export type PlaneAttachmentUploadResult =
  | { ok: true; attachment: PlaneWorkItemAttachment }
  | {
      ok: false
      error: string
      failedStep: PlaneAttachmentUploadFailedStep
      unconfirmedAssetId?: string
    }

export type PlaneUploadWorkItemAttachmentArgs = {
  projectId: string
  workItemId: string
  filePath: string
  workspaceId?: PlaneWorkspaceSelection | null
}

function attachmentsPath(
  client: PlaneClientForWorkspace,
  projectId: string,
  workItemId: string
): string {
  return `${workItemsBase(client, projectId)}${encodeURIComponent(workItemId)}/attachments/`
}

type AttachmentFile = { name: string; size: number; contentType: string; bytes: Buffer }

async function readAttachmentFile(filePath: string): Promise<AttachmentFile | { error: string }> {
  let stats
  try {
    stats = await stat(filePath)
  } catch {
    return { error: `File not found: ${filePath}` }
  }
  if (!stats.isFile()) {
    return { error: `Not a regular file: ${filePath}` }
  }
  if (stats.size === 0) {
    return { error: `File is empty: ${filePath}` }
  }
  if (stats.size > MAX_ATTACHMENT_BYTES) {
    return {
      error: `File is ${stats.size} bytes; the attachment upload limit is ${MAX_ATTACHMENT_BYTES} bytes.`
    }
  }
  const bytes = await readFile(filePath)
  return {
    // The declared size must match the bytes actually sent: the presigned
    // policy pins content-length-range to it, so re-measure after the read.
    name: basename(filePath),
    size: bytes.byteLength,
    contentType:
      ATTACHMENT_CONTENT_TYPE_BY_EXTENSION[extname(filePath).toLowerCase()] ??
      'application/octet-stream',
    bytes
  }
}

type UploadGrant = { url: string; fields: Record<string, string>; assetId: string }

function parseUploadGrant(raw: unknown): UploadGrant | null {
  const record = (raw && typeof raw === 'object' ? raw : {}) as PlaneRecord
  const uploadData = (
    record.upload_data && typeof record.upload_data === 'object' ? record.upload_data : {}
  ) as PlaneRecord
  const url = uploadData.url
  const fields = uploadData.fields
  const assetId = record.asset_id
  if (typeof url !== 'string' || !url || typeof assetId !== 'string' || !assetId) {
    return null
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return null
  }
  const stringFields: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') {
      return null
    }
    stringFields[key] = value
  }
  return { url, fields: stringFields, assetId }
}

// Presigned S3 POST body. Built by hand (not FormData) so tests can assert the
// exact bytes; the `file` part must come last per the S3 POST contract.
function buildStorageUploadBody(
  fields: Record<string, string>,
  file: AttachmentFile
): { body: Buffer; contentType: string } {
  const boundary = `----orca-plane-attachment-${randomUUID()}`
  const safeName = file.name.replace(/[\r\n"]/g, '_')
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8'
      )
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8'
    )
  )
  parts.push(file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function uploadBinaryToStorage(
  grant: UploadGrant,
  file: AttachmentFile
): Promise<string | null> {
  const { body, contentType } = buildStorageUploadBody(grant.fields, file)
  let response: Response
  try {
    response = await planeFetch(grant.url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(STORAGE_UPLOAD_TIMEOUT_MS)
    })
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? `timed out after ${STORAGE_UPLOAD_TIMEOUT_MS / 1000}s`
        : boundedIntegrationErrorMessage(error)
    return `Storage upload failed (${reason}). No file reached storage; nothing was attached.`
  }
  if (!response.ok) {
    return `Storage upload failed (${response.status} ${response.statusText}). No file reached storage; nothing was attached.`
  }
  return null
}

export async function uploadWorkItemAttachment(
  args: PlaneUploadWorkItemAttachmentArgs
): Promise<PlaneAttachmentUploadResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, failedStep: 'validate', error: 'Not connected to Plane.' }
  }
  const file = await readAttachmentFile(args.filePath)
  if ('error' in file) {
    return { ok: false, failedStep: 'validate', error: file.error }
  }

  const basePath = attachmentsPath(client, args.projectId, args.workItemId)
  let grant: UploadGrant | null = null
  await acquire()
  try {
    const raw = await planeRequest<PlaneRecord>(client, basePath, {
      method: 'POST',
      body: JSON.stringify({ name: file.name, type: file.contentType, size: file.size })
    })
    grant = parseUploadGrant(raw)
    if (!grant) {
      return {
        ok: false,
        failedStep: 'upload-grant',
        error:
          'Plane returned an unexpected upload grant (expected upload_data.url, upload_data.fields, asset_id). Nothing was uploaded.'
      }
    }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    const mapped = toMutationError(error, 'Failed to get an upload grant from Plane.')
    return {
      ok: false,
      failedStep: 'upload-grant',
      error: `${mapped.error} Nothing was uploaded.`
    }
  } finally {
    release()
  }

  // The multi-minute storage POST runs outside the Plane API concurrency gate
  // so a slow video upload cannot starve every other Plane call of its slot.
  const storageError = await uploadBinaryToStorage(grant, file)
  if (storageError) {
    return { ok: false, failedStep: 'binary-upload', error: storageError }
  }

  await acquire()
  try {
    await planeRequest(client, `${basePath}${encodeURIComponent(grant.assetId)}/`, {
      method: 'PATCH',
      body: '{}'
    })
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    const mapped = toMutationError(error, 'Plane rejected the confirmation request.')
    return {
      ok: false,
      failedStep: 'confirm',
      unconfirmedAssetId: grant.assetId,
      error: `The file reached storage but was NOT confirmed: ${mapped.error} Asset ${grant.assetId} is not attached to the work item and will not appear in Plane; re-run the upload.`
    }
  } finally {
    release()
  }

  return {
    ok: true,
    attachment: {
      id: grant.assetId,
      name: file.name,
      size: file.size,
      contentType: file.contentType,
      isUploaded: true
    }
  }
}

function mapAttachment(raw: unknown): PlaneWorkItemAttachment {
  const row = (raw && typeof raw === 'object' ? raw : {}) as PlaneRecord
  const attributes = (
    row.attributes && typeof row.attributes === 'object' ? row.attributes : {}
  ) as PlaneRecord
  return {
    id: typeof row.id === 'string' ? row.id : '',
    name: typeof attributes.name === 'string' ? attributes.name : '',
    size: typeof attributes.size === 'number' ? attributes.size : 0,
    contentType: typeof attributes.type === 'string' ? attributes.type : '',
    isUploaded: row.is_uploaded === true
  }
}

export async function listWorkItemAttachments(args: {
  projectId: string
  workItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneWorkItemAttachment[]> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return []
  }
  await acquire()
  try {
    const response = await planeRequest<unknown>(
      client,
      attachmentsPath(client, args.projectId, args.workItemId)
    )
    const rows = Array.isArray(response)
      ? response
      : Array.isArray((response as PlaneRecord)?.results)
        ? ((response as PlaneRecord).results as unknown[])
        : []
    return rows.map(mapAttachment)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    console.warn('[plane] listWorkItemAttachments failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}
