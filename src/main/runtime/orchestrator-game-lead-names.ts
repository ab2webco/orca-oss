/** Each lead's character name, kept from the first read so a scene or language change cannot rename it. */
export class GameLeadNames {
  private readonly names = new Map<string, string>()

  /** The name kept for this lead's pane, else `resolve`'s, which is kept once it names someone. */
  keep(leadPaneKey: string | null, resolve: () => string | null): string | null {
    const kept = leadPaneKey === null ? undefined : this.names.get(leadPaneKey)
    if (kept !== undefined) {
      return kept
    }
    const name = resolve()
    if (leadPaneKey !== null && name) {
      this.names.set(leadPaneKey, name)
    }
    return name
  }
}
