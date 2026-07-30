// Plane project create/update/archive — the workspace-scoped POST/PATCH the
// CLI's `plane project` writes sit on. Split from plane-work-item-writes.ts
// (which is work-item scoped) and reuses its error mapper; project writes are
// the only Plane writes that are NOT project-scoped, so they resolve their
// client by workspace id or slug rather than taking a projectId path segment.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  getClients,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import { getWorkspaceFile } from './plane-workspace-store'
import { mapPlaneProject } from './plane-work-item-mappers'
import { toMutationError, type PlaneRecord } from './plane-work-item-writes'
import type {
  PlaneArchiveProjectArgs,
  PlaneCreateProjectArgs,
  PlaneMutationResult,
  PlaneProjectMutationResult,
  PlaneUpdateProjectArgs
} from '../../shared/plane-types'

function projectsPath(client: PlaneClientForWorkspace): string {
  return `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}/projects/`
}

function projectPath(client: PlaneClientForWorkspace, projectId: string): string {
  return `${projectsPath(client)}${encodeURIComponent(projectId)}/`
}

// Accepts a saved workspace id or a workspace slug. `getClients` only matches on
// id (a slug selection returns [] harmlessly), so the slug lookup is a pure
// fallback that never changes existing id semantics.
export function resolveProjectClient(
  workspace: string | undefined
): PlaneClientForWorkspace | undefined {
  const byId = getClients(workspace)[0]
  if (byId || !workspace) {
    return byId
  }
  const wanted = workspace.trim().toLowerCase()
  const bySlug = getWorkspaceFile().workspaces.find(
    (entry) => entry.workspaceSlug.toLowerCase() === wanted
  )
  return bySlug ? getClients(bySlug.id)[0] : undefined
}

function notConnected(workspace: string | undefined): { ok: false; error: string } {
  return {
    ok: false,
    error: workspace
      ? `No connected Plane workspace matches "${workspace}".`
      : 'Not connected to Plane.'
  }
}

export async function createProject(
  args: PlaneCreateProjectArgs
): Promise<PlaneProjectMutationResult> {
  const client = resolveProjectClient(args.workspace)
  if (!client) {
    return notConnected(args.workspace)
  }
  await acquire()
  try {
    const body: PlaneRecord = { name: args.name, identifier: args.identifier }
    if (args.description !== undefined) {
      body.description = args.description
    }
    const created = await planeRequest<PlaneRecord>(client, projectsPath(client), {
      method: 'POST',
      body: JSON.stringify(body)
    })
    return { ok: true, project: mapPlaneProject(created, client.workspaceSlug) }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to create project.')
  } finally {
    release()
  }
}

export async function updateProject(
  args: PlaneUpdateProjectArgs
): Promise<PlaneProjectMutationResult> {
  const client = resolveProjectClient(args.workspace)
  if (!client) {
    return notConnected(args.workspace)
  }
  await acquire()
  try {
    // Only keys the caller actually set are written, so an omitted field is
    // never overwritten server-side.
    const body: PlaneRecord = {}
    if (args.name !== undefined) {
      body.name = args.name
    }
    if (args.identifier !== undefined) {
      body.identifier = args.identifier
    }
    if (args.description !== undefined) {
      body.description = args.description
    }
    const updated = await planeRequest<PlaneRecord>(client, projectPath(client, args.projectId), {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
    return { ok: true, project: mapPlaneProject(updated, client.workspaceSlug) }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to update project.')
  } finally {
    release()
  }
}

// Archive is POST /archive/, unarchive is DELETE on the same path (204, no
// body), so neither returns a project to map.
export async function setProjectArchived(
  args: PlaneArchiveProjectArgs
): Promise<PlaneMutationResult> {
  const client = resolveProjectClient(args.workspace)
  if (!client) {
    return notConnected(args.workspace)
  }
  await acquire()
  try {
    await planeRequest(client, `${projectPath(client, args.projectId)}archive/`, {
      method: args.archived ? 'POST' : 'DELETE'
    })
    return { ok: true }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(
      error,
      args.archived ? 'Failed to archive project.' : 'Failed to unarchive project.'
    )
  } finally {
    release()
  }
}
