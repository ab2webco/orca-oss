import React from 'react'
import { useAppStore } from '@/store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import { isWebClientLocation } from '@/lib/web-client-location'
import { canPinClaudeAccountToWorktree } from '@/lib/claude-account-runtime-filter'
import type { Repo, Worktree } from '../../../../shared/types'
import { buildWorktreeClaudeAccountChipModel } from './worktree-claude-account-chip-model'

/**
 * Compact indicator of the Claude account in effect for a worktree row: the
 * pinned account, or the globally active account marked as inherited. Hidden for
 * targets where per-worktree Claude accounts don't apply (paired web, SSH,
 * remote runtimes, folder workspaces) so it never shows a wrong value.
 */
export function WorktreeCardClaudeAccountChip({
  worktree,
  repo
}: {
  worktree: Worktree
  repo: Repo | undefined
}): React.JSX.Element | null {
  const roster = useAppStore((s) => s.claudeAccountRoster)

  if (isWebClientLocation() || !canPinClaudeAccountToWorktree(worktree, repo)) {
    return null
  }

  const model = buildWorktreeClaudeAccountChipModel({
    pinnedAccountId: worktree.claudeAccountId,
    wslDistro: getWslDistroFromPath(worktree.path),
    roster,
    systemDefaultLabel: translate(
      'auto.components.sidebar.WorktreeCardClaudeAccountChip.systemDefault',
      'System default'
    )
  })

  // Why: no chip until the account roster is available (never render a wrong/empty value).
  if (!model) {
    return null
  }

  const tooltip = model.isEndpoint
    ? translate(
        'auto.components.sidebar.WorktreeCardClaudeAccountChip.pinnedEndpoint',
        'Pinned Claude endpoint: {{value0}}',
        { value0: model.label }
      )
    : model.inherited
      ? translate(
          'auto.components.sidebar.WorktreeCardClaudeAccountChip.inherited',
          'Claude account (inherited from global): {{value0}}',
          { value0: model.label }
        )
      : translate(
          'auto.components.sidebar.WorktreeCardClaudeAccountChip.pinned',
          'Pinned Claude account: {{value0}}',
          { value0: model.label }
        )

  // Why plain text: V30 draws the account as a dim @account in the row, not a badge (ORCA-1149).
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="min-w-0 max-w-[8rem] shrink-[2] truncate text-[11px] leading-none text-muted-foreground"
          aria-label={tooltip}
        >
          @{model.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
