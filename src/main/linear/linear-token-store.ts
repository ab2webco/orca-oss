import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  LEGACY_WORKSPACE_ID,
  ensureOrcaDir,
  ensureWorkspaceTokenDir,
  getWorkspaceTokenPath
} from './linear-credential-paths'
import {
  clearLegacyViewerOnDisk,
  forgetLegacyViewer,
  resetLegacyViewerCache
} from './linear-legacy-viewer-store'
import { emptyWorkspaceFile } from './linear-workspace-record'
import {
  cacheToken,
  clearCredentialError,
  forgetCachedToken,
  getCachedToken,
  getWorkspaceFile,
  getWorkspaceState,
  recordCredentialError,
  resetCredentialCaches,
  resetWorkspaceFileCacheToEmpty,
  resolveWorkspaceId,
  upsertWorkspace,
  writeWorkspaceFile
} from './linear-workspace-registry'
import {
  CredentialDecryptionError,
  encryptCredentialForFile,
  readIntegrationCredentialFileSync,
  readStoredCredentialTokenAsync
} from '../integration-credential-file'
import { PendingCredentialReads } from '../integration-credential-pending-reads'
import { LatestSecretWrites } from '../safe-storage-async-encrypt'
import type { LinearWorkspace } from '../../shared/linear/workspace-types'

const pendingReads = new PendingCredentialReads<string>('Linear')
const latestWrites = new LatestSecretWrites()

export async function saveWorkspaceToken(workspaceId: string, apiKey: string): Promise<void> {
  const isLatest = latestWrites.begin(workspaceId)
  const tokenBytes = await encryptCredentialForFile('Linear', apiKey)
  if (!isLatest()) {
    return
  }
  ensureOrcaDir()
  if (workspaceId !== LEGACY_WORKSPACE_ID) {
    ensureWorkspaceTokenDir()
  }
  writeFileSync(getWorkspaceTokenPath(workspaceId), tokenBytes, { mode: 0o600 })
  pendingReads.forget(workspaceId)
  cacheToken(workspaceId, apiKey)
  clearCredentialError(workspaceId)
}

// Backward-compatible export for the legacy single-workspace storage path.
export function saveToken(apiKey: string): Promise<void> {
  return saveWorkspaceToken(LEGACY_WORKSPACE_ID, apiKey)
}

export async function loadToken(
  options: { force?: boolean; workspaceId?: string } = {}
): Promise<string | null> {
  const workspaceId = options.workspaceId ?? resolveWorkspaceId()
  if (!workspaceId) {
    return null
  }
  const cached = getCachedToken(workspaceId)
  if (cached !== undefined) {
    return cached
  }
  if (!options.force) {
    return null
  }
  const tokenPath = getWorkspaceTokenPath(workspaceId)
  if (!existsSync(tokenPath)) {
    return null
  }
  return pendingReads.read(workspaceId, {
    load: async () =>
      readStoredCredentialTokenAsync('Linear', readIntegrationCredentialFileSync(tokenPath)),
    commit: (token) => {
      if (token) {
        cacheToken(workspaceId, token)
      }
      clearCredentialError(workspaceId)
    },
    fail: (error) => {
      if (error instanceof CredentialDecryptionError) {
        recordCredentialError(workspaceId, error.message)
        throw error
      }
      return null
    },
    latest: () => getCachedToken(workspaceId) ?? null
  })
}

export function clearTokenFile(workspaceId: string): void {
  latestWrites.supersede(workspaceId)
  pendingReads.forget(workspaceId)
  forgetCachedToken(workspaceId)
  try {
    unlinkSync(getWorkspaceTokenPath(workspaceId))
  } catch {
    // File may not exist — safe to ignore.
  }
}

export function clearToken(workspaceId?: string): void {
  if (!workspaceId) {
    const state = getWorkspaceState()
    for (const workspace of state.workspaces) {
      clearTokenFile(workspace.id)
    }
    latestWrites.supersedeAll()
    pendingReads.clear()
    resetCredentialCaches()
    resetLegacyViewerCache()
    resetWorkspaceFileCacheToEmpty()
    clearLegacyViewerOnDisk()
    writeWorkspaceFile(emptyWorkspaceFile())
    return
  }

  clearTokenFile(workspaceId)
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    resetLegacyViewerCache()
    clearLegacyViewerOnDisk()
    return
  }

  const file = getWorkspaceFile()
  const workspaces = file.workspaces.filter((workspace) => workspace.id !== workspaceId)
  const activeWorkspaceId =
    file.activeWorkspaceId === workspaceId ? (workspaces[0]?.id ?? null) : file.activeWorkspaceId
  const selectedWorkspaceId =
    file.selectedWorkspaceId === workspaceId ? activeWorkspaceId : file.selectedWorkspaceId
  writeWorkspaceFile({
    version: 1,
    activeWorkspaceId,
    selectedWorkspaceId,
    workspaces
  })
}

export async function replaceLegacyWorkspace(
  workspace: LinearWorkspace,
  token: string
): Promise<void> {
  await saveWorkspaceToken(workspace.id, token)
  clearTokenFile(LEGACY_WORKSPACE_ID)
  clearLegacyViewerOnDisk()
  forgetLegacyViewer()
  upsertWorkspace(workspace, { select: true })
}
