// Connection lifecycle for Plane workspaces: status/disconnect/select/test.
// Split out of client.ts (which owns connect() + network plumbing) to stay
// under the oxlint max-lines cap without a suppression.
import { readFetchResponseJsonWithinLimit } from '../lib/fetch-response-body'
import { boundedIntegrationErrorMessage } from '../integration-error-message'
import {
  acquire,
  noWorkspaceAccessError,
  rawClientRequest,
  readPlaneError,
  release,
  toViewer,
  USERS_ME_PATH,
  workspaceMembershipPath,
  type PlaneClientForWorkspace
} from './client'
import {
  deleteCachedViewer,
  deleteWorkspaceToken,
  getCachedViewer,
  getClients,
  getPlaneWorkspaceId,
  getWorkspaceCredentialError,
  getWorkspaceFile,
  getWorkspaceFileReadError,
  hasStoredWorkspaceToken,
  setCachedViewer,
  writeWorkspaceFile
} from './plane-workspace-store'
import type {
  PlaneConnectionStatus,
  PlaneViewer,
  PlaneWorkspace,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

function workspaceToStatusViewer(workspace: PlaneWorkspace | null): PlaneViewer | null {
  return workspace ? getCachedViewer(workspace.id) : null
}

export function status(): PlaneConnectionStatus {
  const file = getWorkspaceFile()
  const workspaces = file.workspaces.filter((workspace) => hasStoredWorkspaceToken(workspace.id))
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === file.activeWorkspaceId) ?? workspaces[0] ?? null
  const credentialError = workspaces
    .map((workspace) => getWorkspaceCredentialError(workspace.id))
    .find((message) => message !== undefined)
  return {
    connected: workspaces.length > 0,
    viewer: workspaceToStatusViewer(activeWorkspace),
    workspaces,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    selectedWorkspaceId: file.selectedWorkspaceId ?? activeWorkspace?.id ?? null,
    ...(credentialError ? { credentialError } : {})
  }
}

export function disconnect(args?: { workspaceId?: string }): void {
  const file = getWorkspaceFile()
  const readError = getWorkspaceFileReadError()
  if (readError) {
    throw readError
  }
  const ids = args?.workspaceId
    ? [args.workspaceId]
    : file.workspaces.map((workspace) => workspace.id)
  for (const id of ids) {
    deleteWorkspaceToken(id)
    deleteCachedViewer(id)
  }
  writeWorkspaceFile({
    version: 1,
    activeWorkspaceId: file.activeWorkspaceId,
    selectedWorkspaceId: file.selectedWorkspaceId,
    workspaces: file.workspaces.filter((workspace) => !ids.includes(workspace.id))
  })
}

export function selectWorkspace(args: {
  workspaceId: PlaneWorkspaceSelection
}): PlaneConnectionStatus {
  const file = getWorkspaceFile()
  if (
    args.workspaceId !== 'all' &&
    !file.workspaces.some((workspace) => workspace.id === args.workspaceId)
  ) {
    return status()
  }
  writeWorkspaceFile({
    ...file,
    activeWorkspaceId: args.workspaceId === 'all' ? file.activeWorkspaceId : args.workspaceId,
    selectedWorkspaceId: args.workspaceId
  })
  return status()
}

export async function testConnection(args?: {
  workspaceId?: string
}): Promise<{ ok: true; viewer: PlaneViewer } | { ok: false; error: string }> {
  let client: PlaneClientForWorkspace | undefined
  try {
    client = getClients(args?.workspaceId ?? undefined)[0]
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? boundedIntegrationErrorMessage(error) : 'Connection failed.'
    }
  }
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }

  await acquire()
  try {
    const meResponse = await rawClientRequest(client, USERS_ME_PATH)
    if (!meResponse.ok) {
      return { ok: false, error: await readPlaneError(meResponse) }
    }
    const viewer = toViewer(
      await readFetchResponseJsonWithinLimit<Record<string, unknown>>(meResponse)
    )

    const membershipResponse = await rawClientRequest(
      client,
      workspaceMembershipPath(client.workspaceSlug)
    )
    if (!membershipResponse.ok) {
      if (membershipResponse.status === 401 || membershipResponse.status === 403) {
        return { ok: false, error: noWorkspaceAccessError(client.workspaceSlug) }
      }
      return { ok: false, error: await readPlaneError(membershipResponse) }
    }

    setCachedViewer(getPlaneWorkspaceId(client.baseUrl, client.workspaceSlug), viewer)
    return { ok: true, viewer }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? boundedIntegrationErrorMessage(error) : 'Connection failed.'
    }
  } finally {
    release()
  }
}
