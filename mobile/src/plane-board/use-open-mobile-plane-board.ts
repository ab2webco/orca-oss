import { useCallback } from 'react'
import { useOpenHostStackRoute } from '../navigation/use-open-host-stack-route'
import { mobilePlaneBoardRouteTarget } from './mobile-plane-board-route'

export function useOpenMobilePlaneBoard(): (hostId: string) => void {
  const openHostStackRoute = useOpenHostStackRoute()

  return useCallback(
    (hostId) => {
      openHostStackRoute(hostId, mobilePlaneBoardRouteTarget(hostId))
    },
    [openHostStackRoute]
  )
}
