/** Where a remote member runs and what its host last said of its terminal (ORCA-824). */
export type GameRemoteHost = {
  host: string
  /** The paired environment View opens the member's terminal through (ORCA-839). */
  environmentId?: string
  stateKnown: boolean
  /** Launched by a lead that no longer leads it; read from the home Run DB (ORCA-793). */
  earlierLead?: true
  /** The home Run completed the member's task. */
  ticketDone?: true
  /** The host answered and the member's terminal is no longer there (ORCA-790). */
  gone?: true
  starting?: true // Its launch has not finished, so the host shows no terminal yet (ORCA-1263).
  /** When the oldest lead mail its host has not taken was sent; absent when none waits (ORCA-1301). */
  undeliveredSince?: string
  /** Why the home's last hand-over of that mail failed; absent before any failed attempt (ORCA-1439). */
  undeliveredReason?: string
  /** A host restart slept the member's pane; resume wakes it (ORCA-915). Absent from an older host. */
  asleep?: true
  /** Its start failed and no agent answers for it, so its name is free again (ORCA-1034). */
  startFailed?: true
  /** The reason the home recorded for that failed start (ORCA-1398). */
  startError?: string
}
