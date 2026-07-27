import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { planeDeleteWorkItem, type RuntimePlaneSettings } from '@/runtime/runtime-plane-client'
import type { useConfirmationDialog } from '@/components/confirmation-dialog'
import { getPlaneMutationErrorMessage } from './plane-mutation-error-message'
import type { PlaneWorkItem } from '../../../shared/plane-types'

/**
 * Confirm by name, then delete a work item. No optimistic removal: the card
 * stays until the delete succeeds and the plane:changed broadcast refetches the
 * list, so a rejection changes nothing on the board.
 */
export async function confirmAndDeletePlaneWorkItem(args: {
  confirm: ReturnType<typeof useConfirmationDialog>
  item: PlaneWorkItem
  projectId: string
  workspaceId: string | null
  providerSettings: RuntimePlaneSettings
}): Promise<void> {
  const { confirm, item, projectId, workspaceId, providerSettings } = args
  const confirmed = await confirm({
    title: translate(
      'auto.components.task-page-plane-board.deleteItemConfirmTitle',
      'Delete work item {{value0}}?',
      { value0: item.identifier }
    ),
    description: translate(
      'auto.components.task-page-plane-board.deleteItemConfirmDescription',
      '«{{value0}}» will be permanently deleted. This cannot be undone.',
      { value0: item.title }
    ),
    confirmLabel: translate('auto.components.task-page-plane-board.deleteConfirmAction', 'Delete'),
    confirmVariant: 'destructive'
  })
  if (!confirmed) {
    return
  }
  const result = await planeDeleteWorkItem(
    providerSettings,
    { projectId, workItemId: item.id },
    workspaceId
  )
  if (!result.ok) {
    console.error('[plane-board] mutation failed:', result.error)
    toast.error(
      getPlaneMutationErrorMessage(
        result.error,
        translate(
          'auto.components.task-page-plane-board.deleteItemFailed',
          'Failed to delete work item.'
        )
      )
    )
  }
}
