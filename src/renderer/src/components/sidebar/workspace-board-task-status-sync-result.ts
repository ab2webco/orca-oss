// Shared outcome vocabulary for the workspace board -> task provider status
// write. Lives apart from the sync entry point so each provider writer can
// accumulate into it without importing its dispatcher.

/** Which task system the message is about, so the copy never names the wrong one. */
export type WorkspaceBoardTaskStatusSyncProvider = 'linear' | 'plane'

export type WorkspaceBoardTaskStatusSyncMessage =
  | {
      kind: 'issue-read-failed'
      provider: WorkspaceBoardTaskStatusSyncProvider
      issueIdentifier: string
    }
  | {
      kind: 'missing-workflow-state'
      provider: WorkspaceBoardTaskStatusSyncProvider
      statusLabel: string
    }
  | {
      kind: 'ambiguous-workflow-state'
      provider: WorkspaceBoardTaskStatusSyncProvider
      statusLabel: string
    }
  | {
      kind: 'update-failed'
      provider: WorkspaceBoardTaskStatusSyncProvider
      issueIdentifier: string
      detail?: string
    }
  | {
      kind: 'provider-error'
      provider: WorkspaceBoardTaskStatusSyncProvider
      issueIdentifier: string
      detail?: string
    }
  // Raised by the caller when the sync itself never produced a result, so it
  // belongs to no provider.
  | { kind: 'unexpected-error'; detail?: string }

export type WorkspaceBoardTaskStatusSyncResult = {
  updated: number
  skipped: number
  failed: number
  messages: WorkspaceBoardTaskStatusSyncMessage[]
}

export function emptyStatusSyncResult(): WorkspaceBoardTaskStatusSyncResult {
  return { updated: 0, skipped: 0, failed: 0, messages: [] }
}

function getMessageKey(message: WorkspaceBoardTaskStatusSyncMessage): string {
  return JSON.stringify(message)
}

export function addMessage(
  result: WorkspaceBoardTaskStatusSyncResult,
  message: WorkspaceBoardTaskStatusSyncMessage
): void {
  const key = getMessageKey(message)
  if (!result.messages.some((item) => getMessageKey(item) === key)) {
    result.messages.push(message)
  }
}

// Why: a silent skip is only honest when there was nothing to write — no link,
// already in the target state, or a newer board move superseded this one. Every
// other non-write passes a message so the drag cannot look like it wrote.
export function skipped(
  result: WorkspaceBoardTaskStatusSyncResult,
  message?: WorkspaceBoardTaskStatusSyncMessage
): WorkspaceBoardTaskStatusSyncResult {
  result.skipped += 1
  if (message) {
    addMessage(result, message)
  }
  return result
}

export function failed(
  result: WorkspaceBoardTaskStatusSyncResult,
  message: WorkspaceBoardTaskStatusSyncMessage
): WorkspaceBoardTaskStatusSyncResult {
  result.failed += 1
  addMessage(result, message)
  return result
}

export function mergeResult(
  aggregate: WorkspaceBoardTaskStatusSyncResult,
  item: WorkspaceBoardTaskStatusSyncResult
): void {
  aggregate.updated += item.updated
  aggregate.skipped += item.skipped
  aggregate.failed += item.failed
  for (const message of item.messages) {
    addMessage(aggregate, message)
  }
}
