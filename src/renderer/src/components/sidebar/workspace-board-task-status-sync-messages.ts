import { translate } from '@/i18n/i18n'
import type {
  WorkspaceBoardTaskStatusSyncMessage,
  WorkspaceBoardTaskStatusSyncProvider,
  WorkspaceBoardTaskStatusSyncResult
} from './workspace-board-task-status-sync-result'

type ProviderScopedMessage = Extract<
  WorkspaceBoardTaskStatusSyncMessage,
  { provider: WorkspaceBoardTaskStatusSyncProvider }
>

function formatLinearMessage(message: ProviderScopedMessage): string {
  switch (message.kind) {
    case 'issue-read-failed':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.c1d2e3f4a5',
        'Linear issue {{value0}} could not be read.',
        { value0: message.issueIdentifier }
      )
    case 'missing-workflow-state':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.d2e3f4a5b6',
        'No matching Linear workflow state for {{value0}}.',
        { value0: message.statusLabel }
      )
    case 'ambiguous-workflow-state':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.e3f4a5b6c7',
        'Multiple Linear workflow states match {{value0}}.',
        { value0: message.statusLabel }
      )
    case 'update-failed':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.f4a5b6c7d8',
        'Could not update Linear issue {{value0}}.',
        { value0: message.issueIdentifier }
      )
    case 'provider-error':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.a5b6c7d8e9',
        'Could not sync Linear issue {{value0}}.',
        { value0: message.issueIdentifier }
      )
  }
}

function formatPlaneMessage(message: ProviderScopedMessage): string {
  switch (message.kind) {
    case 'issue-read-failed':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.planeReadFailed',
        'Plane work item {{value0}} could not be read.',
        { value0: message.issueIdentifier }
      )
    case 'missing-workflow-state':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.planeMissingState',
        'No Plane state matches {{value0}} in this work item project.',
        { value0: message.statusLabel }
      )
    case 'ambiguous-workflow-state':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.planeAmbiguousState',
        'Several Plane states match {{value0}} in this work item project.',
        { value0: message.statusLabel }
      )
    case 'update-failed':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.planeUpdateFailed',
        'Could not update Plane work item {{value0}}.',
        { value0: message.issueIdentifier }
      )
    case 'provider-error':
      return translate(
        'auto.components.sidebar.WorkspaceKanbanDrawer.planeSyncFailed',
        'Could not sync Plane work item {{value0}}.',
        { value0: message.issueIdentifier }
      )
  }
}

export function formatTaskStatusSyncMessage(message: WorkspaceBoardTaskStatusSyncMessage): string {
  if (message.kind === 'unexpected-error') {
    return translate(
      'auto.components.sidebar.WorkspaceKanbanDrawer.b6c7d8e9f0',
      'Task status sync could not finish.'
    )
  }
  return message.provider === 'plane' ? formatPlaneMessage(message) : formatLinearMessage(message)
}

export function formatTaskStatusSyncDescription(
  result: WorkspaceBoardTaskStatusSyncResult
): string {
  const counts = [
    result.updated > 0
      ? translate(
          'auto.components.sidebar.WorkspaceKanbanDrawer.c7d8e9f0a1',
          '{{value0}} updated',
          {
            value0: result.updated
          }
        )
      : null,
    result.skipped > 0
      ? translate(
          'auto.components.sidebar.WorkspaceKanbanDrawer.d8e9f0a1b2',
          '{{value0}} skipped',
          {
            value0: result.skipped
          }
        )
      : null,
    result.failed > 0
      ? translate('auto.components.sidebar.WorkspaceKanbanDrawer.e9f0a1b2c3', '{{value0}} failed', {
          value0: result.failed
        })
      : null
  ].filter((part): part is string => part !== null)
  return [
    counts.join(', '),
    result.messages[0] ? formatTaskStatusSyncMessage(result.messages[0]) : null
  ]
    .filter(Boolean)
    .join('. ')
}
