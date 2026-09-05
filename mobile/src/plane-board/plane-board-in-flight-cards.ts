import { useCallback, useRef, useState } from 'react'

export type PlaneBoardInFlightCards = {
  /** Cards with at least one write still unanswered. */
  ids: ReadonlySet<string>
  begin: (workItemId: string) => void
  end: (workItemId: string) => void
}

/** Counts writes per card: one reply must not free a card another write still holds. */
export function usePlaneBoardInFlightCards(): PlaneBoardInFlightCards {
  const countsRef = useRef(new Map<string, number>())
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set())
  const publish = useCallback((): void => {
    setIds(new Set(countsRef.current.keys()))
  }, [])
  return {
    ids,
    begin: useCallback(
      (workItemId: string): void => {
        countsRef.current.set(workItemId, (countsRef.current.get(workItemId) ?? 0) + 1)
        publish()
      },
      [publish]
    ),
    end: useCallback(
      (workItemId: string): void => {
        const remaining = (countsRef.current.get(workItemId) ?? 0) - 1
        if (remaining > 0) {
          countsRef.current.set(workItemId, remaining)
        } else {
          countsRef.current.delete(workItemId)
        }
        publish()
      },
      [publish]
    )
  }
}
