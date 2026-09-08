import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchPlaneWorkItemDescription,
  isPlaneWorkItemDescriptionReadableByHost
} from '../tasks/plane-mobile-task-source'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'

/**
 * The open card's description.
 *
 * `ready` where the text is known — from the list on a host that still sends it,
 * or from plane.getWorkItem on one that does not. `loading` and `failed` exist
 * because the alternative is rendering nothing, and a body that is silently
 * empty is exactly the failure ORCA-464 is about: the editor would then seed
 * from it and a save would write the blank back over the real description.
 */
export type PlaneWorkItemDescription =
  | { state: 'ready'; text: string }
  | { state: 'loading' }
  | { state: 'failed'; error: string }

export function usePlaneWorkItemDescription(
  client: RpcClient | null,
  capabilities: readonly string[] | undefined,
  workspaceId: string | null,
  item: PlaneMobileWorkItem | null
): PlaneWorkItemDescription {
  const [read, setRead] = useState<Record<string, PlaneWorkItemDescription>>({})
  // Only a host that omits it needs a read; everywhere else the row already has it.
  const omitted = isPlaneWorkItemDescriptionReadableByHost(capabilities)
  const itemId = item?.id ?? null

  useEffect(() => {
    if (!client || !omitted || !itemId || !item?.project.id) {
      return
    }
    let live = true
    const projectId = item.project.id
    setRead((current) =>
      current[itemId] ? current : { ...current, [itemId]: { state: 'loading' } }
    )
    void fetchPlaneWorkItemDescription(client, { workItemId: itemId, projectId, workspaceId })
      .then((text) => {
        if (live) {
          setRead((current) => ({ ...current, [itemId]: { state: 'ready', text } }))
        }
      })
      .catch((error: unknown) => {
        if (live) {
          const message = error instanceof Error ? error.message : 'Could not read the description.'
          setRead((current) => ({ ...current, [itemId]: { state: 'failed', error: message } }))
        }
      })
    return () => {
      live = false
    }
  }, [client, item?.project.id, itemId, omitted, workspaceId])

  if (!omitted) {
    return { state: 'ready', text: item?.description ?? '' }
  }
  return itemId ? (read[itemId] ?? { state: 'loading' }) : { state: 'ready', text: '' }
}
