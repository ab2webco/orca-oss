/** Where a renderer terminal write ended up. Splits "the frame never left the
 *  client" from "the host dropped it" — a payload that only reads the PTY sink
 *  cannot tell those apart (ORCA-295). */
export type RemoteTerminalInputDeliverySite =
  | 'stream-frame'
  | 'stream-refused'
  | 'stream-absent'
  | 'claim-held'
  | 'claim-flushed'
  | 'claim-discarded'
  | 'rpc-fallback'
  | 'rpc-refused'
  | 'io-disconnected'
  | 'io-recovery'
  | 'pane-replaying'
  | 'codex-stale'
  | 'pty-locked'
  | 'input-quarantined'

export type RemoteTerminalInputDeliveryEvent = {
  site: RemoteTerminalInputDeliverySite
  chars: number
}

export type RemoteTerminalInputDeliveryReport = {
  totals: Partial<Record<RemoteTerminalInputDeliverySite, number>>
  events: RemoteTerminalInputDeliveryEvent[]
}

export type RemoteTerminalInputDeliveryProbe = {
  snapshot: () => Record<string, RemoteTerminalInputDeliveryReport>
  reset: () => void
}
