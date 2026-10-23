/** What the host saw of a dispatched agent without asking it; optional, so older hosts send neither. */
export type AgentStatusOrchestrationLiveness = {
  /** The dispatch's host-observed activity (ORCA-746). */
  lastActivityAt?: string
  /** Failed for silence yet still working, and not reopened because something replaced it (ORCA-658). */
  orphaned?: boolean
}
