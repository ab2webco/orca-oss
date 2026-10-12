/** Statuses whose panels are mounted. `idle` and `restarting` still show panels
 *  — the panel itself never needs a worker — but `errored` does not, so any
 *  surface offering a panel must agree with this or it opens an empty state. */
export function isPluginPanelMountedStatus(status: string): boolean {
  return status === 'running' || status === 'restarting' || status === 'idle'
}
