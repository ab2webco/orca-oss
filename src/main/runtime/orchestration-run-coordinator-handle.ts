type RunCoordinatorBinding = {
  coordinator_handle: string | null
  coordinator_pane_key: string | null
}

type TerminalLookup = {
  isOpen: (handle: string) => boolean
  handleForPaneKey: (paneKey: string) => string | null
}

/**
 * The run's coordinator as a live handle. Why the pane: a restart remints the lead's handle, while
 * the run stays bound to its pane, so the saved handle alone would orphan every member (ORCA-764).
 */
export function liveRunCoordinatorHandle(
  run: RunCoordinatorBinding,
  terminals: TerminalLookup
): string | undefined {
  const saved = run.coordinator_handle ?? undefined
  if (!saved || !run.coordinator_pane_key || terminals.isOpen(saved)) {
    return saved
  }
  const current = terminals.handleForPaneKey(run.coordinator_pane_key)
  return current && terminals.isOpen(current) ? current : saved
}
