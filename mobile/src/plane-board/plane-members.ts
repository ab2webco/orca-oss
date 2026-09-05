import type { RpcClient } from '../transport/rpc-client'
import { decodePlaneMembers, type PlaneMobileMember } from '../tasks/plane-mobile-work-item-read'

/** Sends the literal method name so the mobile RPC allowlist test can see it. */
export async function fetchPlaneMembers(
  client: RpcClient,
  args: { projectId: string; workspaceId: string | null }
): Promise<PlaneMobileMember[]> {
  const response = await client.sendRequest('plane.listMembers', {
    projectId: args.projectId,
    workspaceId: args.workspaceId ?? undefined
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return decodePlaneMembers(response.result)
}
