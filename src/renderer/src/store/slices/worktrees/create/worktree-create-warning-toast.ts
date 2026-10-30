import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { resolveWorktreeDisplayName } from '@/lib/worktree-default-display-name'
import type { Worktree } from '../../../../../../shared/worktree/types'

export function showWorktreeCreateWarningToast(
  warning: string | undefined,
  createdWorktree: Pick<Worktree, 'id' | 'displayName' | 'branch' | 'path'>
): void {
  if (!warning) {
    return
  }
  const worktreeName = resolveWorktreeDisplayName(createdWorktree).trim()
  // Why: Infinity because the warning (e.g. skipped commit hooks) needs action after create.
  toast.warning(
    worktreeName
      ? translate(
          'auto.store.slices.worktrees.createWarningForWorktree',
          'Workspace "{{value0}}" was created with a warning',
          { value0: worktreeName }
        )
      : translate('auto.store.slices.worktrees.createWarning', 'Workspace created with a warning'),
    {
      id: `worktree-create-warning:${createdWorktree.id}`,
      description: warning,
      duration: Infinity,
      dismissible: true
    }
  )
}
