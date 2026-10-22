import { isClaudeTerminalBackgroundTaskStatus } from './claude-background-task-inventory'

/** Claude lists a Monitor tool's watcher in `background_tasks` as a plain `shell` task;
 *  only the Monitor PostToolUse ties that task id to a watcher instead of real work. */
function readClaudeMonitorTaskId(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): string | undefined {
  if (eventName !== 'PostToolUse' || hookPayload['tool_name'] !== 'Monitor') {
    return undefined
  }
  const response = hookPayload['tool_response']
  if (typeof response !== 'object' || response === null) {
    return undefined
  }
  const taskId = (response as Record<string, unknown>)['taskId']
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId.trim() : undefined
}

function retainListedTaskIds(taskIds: Set<string>, backgroundTasks: unknown[]): Set<string> {
  const listed = new Set<string>()
  for (const item of backgroundTasks) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id.trim() : ''
    const status = typeof obj.status === 'string' ? obj.status.trim().toLowerCase() : ''
    if (taskIds.has(id) && !isClaudeTerminalBackgroundTaskStatus(status)) {
      listed.add(id)
    }
  }
  return listed
}

/** Record a pane's Monitor task ids and return the ones still armed; a lead inventory that no longer lists one as running retires it. */
export function trackClaudeMonitorTaskIds(
  taskIdsByPaneKey: Map<string, Set<string>>,
  paneKey: string,
  eventName: unknown,
  hookPayload: Record<string, unknown>,
  isLeadEvent: boolean
): ReadonlySet<string> | undefined {
  let taskIds = taskIdsByPaneKey.get(paneKey)
  const monitorTaskId = readClaudeMonitorTaskId(eventName, hookPayload)
  if (monitorTaskId) {
    taskIds = new Set(taskIds)
    taskIds.add(monitorTaskId)
  }
  const backgroundTasks = hookPayload['background_tasks']
  if (taskIds && isLeadEvent && Array.isArray(backgroundTasks)) {
    taskIds = retainListedTaskIds(taskIds, backgroundTasks)
  }
  if (taskIds && taskIds.size > 0) {
    taskIdsByPaneKey.set(paneKey, taskIds)
    return taskIds
  }
  taskIdsByPaneKey.delete(paneKey)
  return undefined
}
