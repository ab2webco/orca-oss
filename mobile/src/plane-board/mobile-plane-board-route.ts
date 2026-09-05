import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'

/** Host id stays raw — the navigator owns the params, so pre-encoding one would
 *  reach the board screen still escaped. */
export function mobilePlaneBoardRouteTarget(hostId: string): HostStackRouteTarget {
  return {
    name: '[hostId]/plane-board',
    params: { hostId }
  }
}
