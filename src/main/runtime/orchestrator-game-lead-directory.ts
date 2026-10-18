/** A project's lead as `orca game lead` registered it on this Orca host. */
export type GameLeadEntry = {
  projectKey: string
  project: string
  handle: string
  label: string
  at: string
}

/**
 * The leads on this host. Why registered, not derived: the host cannot tell a lead from any other
 * Claude tab, so a session is a lead only once `game lead` said so. In memory: handles die with the app.
 */
export class GameLeadDirectory {
  private readonly byProject = new Map<string, GameLeadEntry>()

  /** One lead per project, and one project per terminal: the latest registration wins both. */
  register(entry: GameLeadEntry): void {
    for (const [key, one] of this.byProject) {
      if (one.handle === entry.handle) {
        this.byProject.delete(key)
      }
    }
    this.byProject.set(entry.projectKey, entry)
  }

  live(isLive: (handle: string) => boolean): GameLeadEntry[] {
    return [...this.byProject.values()].filter((one) => isLive(one.handle))
  }

  leadOf(projectKey: string, isLive: (handle: string) => boolean): GameLeadEntry | null {
    const found = this.byProject.get(projectKey)
    return found && isLive(found.handle) ? found : null
  }

  /** Lead handle to the name a reader knows it by. */
  labelsOf(isLive: (handle: string) => boolean): Record<string, string> {
    return Object.fromEntries(
      this.live(isLive).map((one) => [one.handle, one.label || one.project])
    )
  }
}
