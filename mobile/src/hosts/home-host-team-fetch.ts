import { sendSingleFlightRequest } from '../transport/request-single-flight'
import type { RpcClient } from '../transport/rpc-client'
import { readHostTeamLine } from './host-team-read'
import type { HostTeamLine } from './host-team-line'

export type HostTeamLineSetter = (
  updater: (prev: Record<string, HostTeamLine | null>) => Record<string, HostTeamLine | null>
) => void

/** The capabilities a status.get answer advertises; none from an answer it does not recognise. */
export function hostCapabilitiesOf(result: unknown): string[] {
  const raw =
    result && typeof result === 'object'
      ? (result as { capabilities?: unknown }).capabilities
      : null
  return Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string') : []
}

/** Reads one host's team line for its Home card; a failed refresh keeps the last line it proved. */
export function fetchHomeHostTeamLine(
  client: RpcClient,
  hostId: string,
  setLines: HostTeamLineSetter,
  disposed: () => boolean
): Promise<void> {
  return sendSingleFlightRequest(client, hostId, 'status.get')
    .then(async (status) => {
      if (disposed() || !status.ok) {
        return
      }
      const line = await readHostTeamLine(client, hostCapabilitiesOf(status.result))
      if (!disposed()) {
        setLines((prev) => ({ ...prev, [hostId]: line }))
      }
    })
    .catch(() => undefined)
}
