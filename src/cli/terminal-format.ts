import type { AgentSessionLogUnreadReason } from '../shared/agent-session-log-state'
import type {
  RuntimeTerminalAgentSessionState,
  RuntimeTerminalClose,
  RuntimeTerminalCreate,
  RuntimeTerminalFocus,
  RuntimeTerminalListResult,
  RuntimeTerminalVisualLayout,
  RuntimeTerminalVisualLayoutNode,
  RuntimeTerminalVisualPaneNode,
  RuntimeTerminalVisualTab,
  RuntimeTerminalRead,
  RuntimeTerminalRename,
  RuntimeTerminalSend,
  RuntimeTerminalShow,
  RuntimeTerminalSplit,
  RuntimeTerminalSummary,
  RuntimeTerminalWait
} from '../shared/runtime-types'

/** Human-readable liveness. `connected`/`disconnected` cannot separate a
 *  sleeping agent from a dead pane, and the human output must not force the
 *  reader into the same wrong inference the JSON output now prevents. */
function formatTerminalLiveness(terminal: RuntimeTerminalSummary): string {
  switch (terminal.liveness) {
    case 'starting':
      return 'starting (transport binding)'
    case 'running':
      return 'running'
    case 'sleeping':
      return `sleeping (${terminal.sleepingAgent?.agent ?? 'agent'}, wake to resume)`
    case 'gone':
      return 'gone'
  }
}

/** Why on the same line as liveness: `running` is true of the shell and says
 *  nothing about the agent. A pane whose launch command was never written is
 *  connected, titled, and empty, and reads as healthy without this (ORCA-210). */
function formatStartupCommandWithheld(terminal: RuntimeTerminalSummary): string {
  return terminal.startupCommandWithheld ? '  [no agent: launch command not yet sent]' : ''
}

export function formatTerminalList(result: RuntimeTerminalListResult): string {
  if (result.terminals.length === 0) {
    return 'No terminals.'
  }
  const body = result.terminals
    .map(
      (terminal) =>
        `${terminal.handle}  ${terminal.title ?? '(untitled)'}  ${formatTerminalLiveness(terminal)}${formatStartupCommandWithheld(terminal)}  ${terminal.worktreePath}\n${terminal.preview ? `preview: ${terminal.preview}` : 'preview: <empty>'}`
    )
    .join('\n\n')
  const visualLayout = formatTerminalVisualLayouts(result.visualLayouts)
  const bodyWithLayout = visualLayout ? `${body}\n\nvisual layout:\n${visualLayout}` : body
  return result.truncated
    ? `${bodyWithLayout}\n\ntruncated: showing ${result.terminals.length} of ${result.totalCount}`
    : bodyWithLayout
}

function formatTerminalVisualLayouts(
  layouts: readonly RuntimeTerminalVisualLayout[] | undefined
): string | null {
  if (!layouts || layouts.length === 0) {
    return null
  }
  return layouts
    .map((layout) =>
      [
        `worktree: ${layout.worktreePath || layout.worktreeId}`,
        ...formatVisualLayoutNode(layout.root, 0)
      ].join('\n')
    )
    .join('\n\n')
}

function formatVisualLayoutNode(node: RuntimeTerminalVisualLayoutNode, depth: number): string[] {
  const indent = '  '.repeat(depth)
  if (node.type === 'split') {
    return [
      `${indent}split ${node.direction}`,
      ...formatVisualLayoutNode(node.first, depth + 1),
      ...formatVisualLayoutNode(node.second, depth + 1)
    ]
  }
  return [
    `${indent}group ${node.groupId ?? '(default)'}`,
    ...node.tabs.flatMap((tab) => formatVisualTab(tab, depth + 1))
  ]
}

function formatVisualTab(tab: RuntimeTerminalVisualTab, depth: number): string[] {
  const indent = '  '.repeat(depth)
  return [
    `${indent}tab ${tab.tabId}  ${tab.title ?? '(untitled)'}`,
    ...formatVisualPaneNode(tab.panes, depth + 1)
  ]
}

function formatVisualPaneNode(node: RuntimeTerminalVisualPaneNode, depth: number): string[] {
  const indent = '  '.repeat(depth)
  if (node.type === 'pane-split') {
    return [
      `${indent}pane split ${node.direction}`,
      ...formatVisualPaneNode(node.first, depth + 1),
      ...formatVisualPaneNode(node.second, depth + 1)
    ]
  }
  const marker = node.active ? '* ' : '  '
  return [
    `${indent}${marker}${node.handle}  ${node.title ?? '(untitled)'}  tab=${node.tabId} leaf=${node.leafId}`
  ]
}

export function formatTerminalShow(result: { terminal: RuntimeTerminalShow }): string {
  const terminal = result.terminal
  return [
    `handle: ${terminal.handle}`,
    `title: ${terminal.title ?? '(untitled)'}`,
    `worktree: ${terminal.worktreePath}`,
    `branch: ${terminal.branch}`,
    `leaf: ${terminal.leafId}`,
    `ptyId: ${terminal.ptyId ?? 'none'}`,
    `liveness: ${formatTerminalLiveness(terminal)}`,
    ...(terminal.startupCommandWithheld
      ? ['startupCommand: not sent (shell never reached a prompt; no agent in this pane)']
      : []),
    `connected: ${terminal.connected}`,
    `writable: ${terminal.writable}`,
    `preview: ${terminal.preview || '<empty>'}`
  ].join('\n')
}

export function formatTerminalRead(result: { terminal: RuntimeTerminalRead }): string {
  const terminal = result.terminal
  const oldestCursor =
    typeof terminal.oldestCursor === 'string' ? [`oldest cursor: ${terminal.oldestCursor}`] : []
  const latestCursor =
    typeof terminal.latestCursor === 'string' ? [`latest cursor: ${terminal.latestCursor}`] : []
  const limitedWarning = formatTerminalReadLimitedWarning(terminal)
  const header = [
    `handle: ${terminal.handle}`,
    `status: ${terminal.status}`,
    ...(terminal.nextCursor !== null ? [`cursor: ${terminal.nextCursor}`] : []),
    ...oldestCursor,
    ...latestCursor,
    ...(terminal.truncated ? ['warning: older output is no longer retained'] : []),
    ...(limitedWarning ? [limitedWarning] : [])
  ]
  return [...header, '', ...terminal.tail].join('\n')
}

function formatTerminalReadLimitedWarning(terminal: RuntimeTerminalRead): string | null {
  if (!terminal.limited) {
    return null
  }
  if (
    typeof terminal.nextCursor === 'string' &&
    typeof terminal.latestCursor === 'string' &&
    terminal.nextCursor !== terminal.latestCursor
  ) {
    return `warning: output limited; continue with --cursor ${terminal.nextCursor}`
  }
  if (
    typeof terminal.oldestCursor === 'string' &&
    typeof terminal.latestCursor === 'string' &&
    terminal.oldestCursor !== terminal.latestCursor
  ) {
    // A tail preview's next cursor is already latest, so oldestCursor is the retained history entry point.
    return `warning: output limited; page retained output with --cursor ${terminal.oldestCursor} --limit <count>`
  }
  return 'warning: output limited'
}

export function formatTerminalSend(result: { send: RuntimeTerminalSend }): string {
  return `Sent ${result.send.bytesWritten} bytes to ${result.send.handle}.`
}

export function formatTerminalRename(result: { rename: RuntimeTerminalRename }): string {
  return result.rename.title
    ? `Renamed terminal ${result.rename.handle} to "${result.rename.title}".`
    : `Cleared title for terminal ${result.rename.handle}.`
}

export function formatTerminalCreate(result: { terminal: RuntimeTerminalCreate }): string {
  const titleNote = result.terminal.title ? ` (title: "${result.terminal.title}")` : ''
  const surfaceNote = result.terminal.surface ? ` [${result.terminal.surface}]` : ''
  const readinessNote =
    result.terminal.connected !== undefined ||
    result.terminal.writable !== undefined ||
    result.terminal.liveness !== undefined
      ? ` [connected: ${result.terminal.connected ?? 'unknown'}, writable: ${result.terminal.writable ?? 'unknown'}, liveness: ${result.terminal.liveness ?? 'unknown'}]`
      : ''
  const warningNote = result.terminal.warning ? `\nwarning: ${result.terminal.warning}` : ''
  return `Created terminal ${result.terminal.handle}${titleNote}${surfaceNote}${readinessNote}${warningNote}`
}

export function formatTerminalSplit(result: { split: RuntimeTerminalSplit }): string {
  return `Split pane ${result.split.handle} in tab ${result.split.tabId}`
}

export function formatTerminalFocus(result: { focus: RuntimeTerminalFocus }): string {
  if (result.focus.navigated === false) {
    return `Focus request for terminal ${result.focus.handle} was superseded or host navigation was skipped (tab ${result.focus.tabId}).`
  }
  return `Focused terminal ${result.focus.handle} (tab ${result.focus.tabId}).`
}

export function formatTerminalClose(result: { close: RuntimeTerminalClose }): string {
  if (result.close.closeMode === 'tab') {
    return `Closed terminal tab ${result.close.tabId} (${result.close.handle}).`
  }
  const ptyNote = result.close.ptyKilled ? ' PTY killed.' : ''
  return `Closed terminal ${result.close.handle}.${ptyNote}`
}

export function formatTerminalWait(result: { wait: RuntimeTerminalWait }): string {
  const lines = [
    `handle: ${result.wait.handle}`,
    `condition: ${result.wait.condition}`,
    `satisfied: ${result.wait.satisfied}`,
    `status: ${result.wait.status}`,
    `exitCode: ${result.wait.exitCode ?? 'null'}`
  ]
  if (result.wait.blockedReason) {
    lines.push(`blockedReason: ${result.wait.blockedReason}`)
  }
  if (result.wait.composerReadyState) {
    lines.push(`composerReadyState: ${result.wait.composerReadyState}`)
  }
  if (typeof result.wait.waitedMs === 'number') {
    lines.push(`waitedMs: ${result.wait.waitedMs}`)
  }
  return lines.join('\n')
}

const AGENT_SESSION_UNREAD_TEXT: Record<AgentSessionLogUnreadReason, string> = {
  'agent-unsupported': 'this agent writes no session log Orca can read',
  'agent-session-unknown': 'no agent session is identified for this pane yet',
  'session-log-missing': 'no session log found for this pane',
  'session-log-unreadable': 'the session log could not be read'
}

export function formatTerminalAgentSessionState(result: {
  agentSession: RuntimeTerminalAgentSessionState
}): string {
  const { handle, agent, sessionId, session } = result.agentSession
  const identity = [
    `handle: ${handle}`,
    `agent: ${agent ?? 'unknown'}`,
    `session: ${sessionId ?? 'unknown'}`
  ]
  if (!session.read) {
    return [...identity, `state: unknown — ${AGENT_SESSION_UNREAD_TEXT[session.reason]}`].join('\n')
  }
  const lastTurn =
    session.lastTurnAtMs === null
      ? 'last turn: none in the session log'
      : `last turn: ${new Date(session.lastTurnAtMs).toISOString()}`
  const queued = session.queuedInput.supported
    ? `queued input: ${session.queuedInput.pending}`
    : `queued input: unobservable — ${session.queuedInput.reason}`
  return [
    ...identity,
    `state: ${session.state}`,
    lastTurn,
    queued,
    ...(session.unparsedRecords > 0
      ? [`warning: ${session.unparsedRecords} session-log records could not be parsed`]
      : [])
  ].join('\n')
}
