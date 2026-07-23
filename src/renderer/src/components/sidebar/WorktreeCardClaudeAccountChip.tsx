import React from 'react'
import { AtSign, Globe, Pin } from 'lucide-react'
import { useAppStore } from '@/store'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import { isWebClientLocation } from '@/lib/web-client-location'
import { isLocalClaudeAccountWorktreeTarget } from '@/lib/claude-account-runtime-filter'
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

  if (isWebClientLocation() || !isLocalClaudeAccountWorktreeTarget(worktree, repo)) {
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

  const Icon = model.isEndpoint ? Globe : model.inherited ? AtSign : Pin
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            'h-[16px] max-w-[8rem] shrink-0 gap-1 rounded px-1.5 text-[10px] font-medium leading-none',
            model.inherited
              ? 'text-muted-foreground border-border/60 bg-transparent'
              : 'text-foreground/80 border-foreground/20 bg-foreground/[0.06]'
          )}
          aria-label={tooltip}
        >
          <Icon className="size-2.5 shrink-0" />
          <span className="truncate">{model.label}</span>
          {model.inherited && (
            <span className="shrink-0 opacity-60">
              {translate(
                'auto.components.sidebar.WorktreeCardClaudeAccountChip.globalMarker',
                '(global)'
              )}
            </span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
