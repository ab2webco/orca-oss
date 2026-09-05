import { useCallback, useRef, useState } from 'react'
import type { PlaneMobileMember } from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import { fetchPlaneMembers } from './plane-members'

export type PlaneMembersStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PlaneMembers = {
  members: PlaneMobileMember[]
  status: PlaneMembersStatus
  /** Reads the project members once; a later call is a no-op unless the read failed. */
  load: () => void
}

type Loaded = { projectId: string | null; members: PlaneMobileMember[]; status: PlaneMembersStatus }

const IDLE: Loaded = { projectId: null, members: [], status: 'idle' }

/** Members are read lazily, when a detail opens, so a board that never assigns
 *  never pays for the request. */
export function usePlaneMembers(
  client: RpcClient | null,
  projectId: string | null,
  workspaceId: string | null
): PlaneMembers {
  const [loaded, setLoaded] = useState<Loaded>(IDLE)
  const generationRef = useRef(0)
  // A project switch makes the stored list someone else's.
  const current = loaded.projectId === projectId ? loaded : IDLE

  const load = useCallback((): void => {
    if (!client || !projectId || current.status === 'loading' || current.status === 'ready') {
      return
    }
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoaded({ projectId, members: [], status: 'loading' })
    void fetchPlaneMembers(client, { projectId, workspaceId })
      .then((members) => {
        if (generationRef.current === generation) {
          setLoaded({ projectId, members, status: 'ready' })
        }
      })
      .catch(() => {
        if (generationRef.current === generation) {
          setLoaded({ projectId, members: [], status: 'error' })
        }
      })
  }, [client, current.status, projectId, workspaceId])

  return { members: current.members, status: current.status, load }
}
