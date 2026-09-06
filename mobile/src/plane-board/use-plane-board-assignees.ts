import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { arePlaneMembersListableByHost } from './plane-board-writes-capability'
import { usePlaneMembers, type PlaneMembers } from './use-plane-members'

export type PlaneBoardAssignees = {
  /** False on a host that refuses plane.listMembers; no assignee picker renders at all. */
  canAssign: boolean
  members: PlaneMembers['members']
  membersStatus: PlaneMembers['status']
  loadMembers: () => void
}

type Input = {
  client: RpcClient | null
  projectId: string | null
  workspaceId: string | null
  capabilities: readonly string[] | undefined
}

export function usePlaneBoardAssignees({
  client,
  projectId,
  workspaceId,
  capabilities
}: Input): PlaneBoardAssignees {
  const canAssign = arePlaneMembersListableByHost(capabilities)
  const members = usePlaneMembers(client, projectId, workspaceId)
  const { load } = members
  return {
    canAssign,
    members: members.members,
    membersStatus: members.status,
    loadMembers: useCallback(() => {
      if (canAssign) {
        load()
      }
    }, [canAssign, load])
  }
}
