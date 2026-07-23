// Persistence for Plane workspace metadata (identity, viewer cache, client
// resolution). Encrypted API-key storage lives in plane-token-storage.ts —
// split out to keep each file under the oxlint max-lines cap without a
// suppression. Mirrors jira/client.ts's site-file pattern.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CredentialDecryptionError,
  readIntegrationCredentialFileSyncText
} from '../integration-credential-file'
import {
  assertIntegrationAccountCount,
  assertIntegrationStringBytes,
  IntegrationAccountPersistenceLimitError,
  MAX_INTEGRATION_ACCOUNT_ID_BYTES,
  MAX_INTEGRATION_ACCOUNT_LABEL_BYTES,
  MAX_INTEGRATION_ACCOUNT_URL_BYTES,
  serializeIntegrationAccountFile,
  unreadableIntegrationAccountFileError
} from '../integration-account-persistence-limits'
import { hasStoredWorkspaceToken, readWorkspaceToken } from './plane-token-storage'
import type { PlaneViewer, PlaneWorkspace, PlaneWorkspaceSelection } from '../../shared/plane-types'
import type { PlaneClientForWorkspace } from './client'

export {
  hasStoredWorkspaceToken,
  readWorkspaceToken,
  saveWorkspaceToken,
  deleteWorkspaceToken,
  getWorkspaceCredentialError
} from './plane-token-storage'

export type PlaneWorkspaceFile = {
  version: 1
  activeWorkspaceId: string | null
  selectedWorkspaceId: PlaneWorkspaceSelection | null
  workspaces: PlaneWorkspace[]
}

let cachedWorkspaceFile: PlaneWorkspaceFile | null = null
let workspaceFileLoaded = false
let workspaceFileReadError: Error | null = null

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getWorkspaceFilePath(): string {
  return join(getOrcaDir(), 'plane-workspaces.json')
}

function ensureOrcaDir(): void {
  const dir = getOrcaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function emptyWorkspaceFile(): PlaneWorkspaceFile {
  return { version: 1, activeWorkspaceId: null, selectedWorkspaceId: null, workspaces: [] }
}

function normalizeWorkspace(input: unknown): PlaneWorkspace | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    typeof record.baseUrl !== 'string' ||
    typeof record.workspaceSlug !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    baseUrl: record.baseUrl,
    workspaceSlug: record.workspaceSlug,
    ...(typeof record.displayName === 'string' ? { displayName: record.displayName } : {})
  }
}

function assertWorkspaceBounds(workspace: PlaneWorkspace): void {
  assertIntegrationStringBytes(
    'Plane',
    'workspace ID',
    workspace.id,
    MAX_INTEGRATION_ACCOUNT_ID_BYTES
  )
  assertIntegrationStringBytes(
    'Plane',
    'base URL',
    workspace.baseUrl,
    MAX_INTEGRATION_ACCOUNT_URL_BYTES
  )
  assertIntegrationStringBytes(
    'Plane',
    'workspace slug',
    workspace.workspaceSlug,
    MAX_INTEGRATION_ACCOUNT_LABEL_BYTES
  )
  if (workspace.displayName) {
    assertIntegrationStringBytes(
      'Plane',
      'display name',
      workspace.displayName,
      MAX_INTEGRATION_ACCOUNT_LABEL_BYTES
    )
  }
}

export function assertWorkspaceFileBounds(file: PlaneWorkspaceFile): void {
  assertIntegrationAccountCount('Plane', file.workspaces.length)
  for (const workspace of file.workspaces) {
    assertWorkspaceBounds(workspace)
  }
}

function readWorkspaceFileFromDisk(): PlaneWorkspaceFile {
  const path = getWorkspaceFilePath()
  if (!existsSync(path)) {
    workspaceFileReadError = null
    return emptyWorkspaceFile()
  }
  try {
    const parsed = JSON.parse(
      readIntegrationCredentialFileSyncText(path)
    ) as Partial<PlaneWorkspaceFile>
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.workspaces)
    ) {
      throw unreadableIntegrationAccountFileError('Plane')
    }
    assertIntegrationAccountCount('Plane', parsed.workspaces.length)
    const workspaces: PlaneWorkspace[] = []
    for (const input of parsed.workspaces) {
      const workspace = normalizeWorkspace(input)
      if (!workspace) {
        throw unreadableIntegrationAccountFileError('Plane')
      }
      assertWorkspaceBounds(workspace)
      if (hasStoredWorkspaceToken(workspace.id)) {
        workspaces.push(workspace)
      }
    }
    const activeWorkspaceId =
      typeof parsed.activeWorkspaceId === 'string' &&
      workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
        ? parsed.activeWorkspaceId
        : (workspaces[0]?.id ?? null)
    const selectedWorkspaceId =
      parsed.selectedWorkspaceId === 'all' ||
      (typeof parsed.selectedWorkspaceId === 'string' &&
        workspaces.some((workspace) => workspace.id === parsed.selectedWorkspaceId))
        ? parsed.selectedWorkspaceId
        : activeWorkspaceId
    workspaceFileReadError = null
    return { version: 1, activeWorkspaceId, selectedWorkspaceId, workspaces }
  } catch {
    workspaceFileReadError = unreadableIntegrationAccountFileError('Plane')
    return emptyWorkspaceFile()
  }
}

export function getWorkspaceFile(): PlaneWorkspaceFile {
  if (!workspaceFileLoaded || !cachedWorkspaceFile) {
    cachedWorkspaceFile = readWorkspaceFileFromDisk()
    workspaceFileLoaded = true
  }
  return cachedWorkspaceFile
}

export function getWorkspaceFileReadError(): Error | null {
  return workspaceFileReadError
}

export function writeWorkspaceFile(file: PlaneWorkspaceFile): void {
  if (workspaceFileReadError) {
    throw workspaceFileReadError
  }
  assertWorkspaceFileBounds(file)
  ensureOrcaDir()
  const workspaces = file.workspaces.filter((workspace) => hasStoredWorkspaceToken(workspace.id))
  const activeWorkspaceId =
    file.activeWorkspaceId &&
    workspaces.some((workspace) => workspace.id === file.activeWorkspaceId)
      ? file.activeWorkspaceId
      : (workspaces[0]?.id ?? null)
  const selectedWorkspaceId =
    file.selectedWorkspaceId === 'all'
      ? 'all'
      : file.selectedWorkspaceId &&
          workspaces.some((workspace) => workspace.id === file.selectedWorkspaceId)
        ? file.selectedWorkspaceId
        : activeWorkspaceId

  const nextFile: PlaneWorkspaceFile = {
    version: 1,
    activeWorkspaceId,
    selectedWorkspaceId,
    workspaces
  }
  const serialized = serializeIntegrationAccountFile(nextFile)
  writeFileSync(getWorkspaceFilePath(), serialized, { encoding: 'utf-8', mode: 0o600 })
  cachedWorkspaceFile = nextFile
  workspaceFileLoaded = true
}

// Viewer identity is cached in memory only (not persisted): PlaneWorkspace
// carries connection identity, not viewer info, so a fresh app start reports
// viewer: null until the next connect()/testConnection() repopulates it.
const cachedViewers = new Map<string, PlaneViewer>()

export function getCachedViewer(workspaceId: string): PlaneViewer | null {
  return cachedViewers.get(workspaceId) ?? null
}

export function setCachedViewer(workspaceId: string, viewer: PlaneViewer): void {
  cachedViewers.set(workspaceId, viewer)
}

export function deleteCachedViewer(workspaceId: string): void {
  cachedViewers.delete(workspaceId)
}

// Workspace identity = (baseUrl, workspaceSlug), never the API key: a Plane
// PAT is account-level and is expected to be reused across workspace rows.
export function getPlaneWorkspaceId(baseUrl: string, workspaceSlug: string): string {
  return createHash('sha256')
    .update(`${baseUrl}\n${workspaceSlug}`)
    .digest('base64url')
    .slice(0, 24)
}

export function getClients(selection?: PlaneWorkspaceSelection | null): PlaneClientForWorkspace[] {
  const file = getWorkspaceFile()
  const selected = selection ?? file.selectedWorkspaceId ?? file.activeWorkspaceId
  const isAllSelection = selected === 'all'
  const workspaces = isAllSelection
    ? file.workspaces
    : file.workspaces.filter((workspace) => workspace.id === (selected ?? file.activeWorkspaceId))

  return workspaces.flatMap((workspace) => {
    let apiKey: string | null
    try {
      apiKey = readWorkspaceToken(workspace.id)
    } catch (error) {
      // Why: under an 'all' selection one un-decryptable workspace must not
      // collapse reads for the healthy ones; a specific-workspace selection
      // still rethrows so the renderer can surface the decrypt banner.
      if (
        isAllSelection &&
        (error instanceof CredentialDecryptionError ||
          error instanceof IntegrationAccountPersistenceLimitError)
      ) {
        return []
      }
      throw error
    }
    return apiKey
      ? [
          {
            baseUrl: workspace.baseUrl,
            workspaceSlug: workspace.workspaceSlug,
            headers: {
              'x-api-key': apiKey,
              'x-workspace-slug': workspace.workspaceSlug
            }
          }
        ]
      : []
  })
}
