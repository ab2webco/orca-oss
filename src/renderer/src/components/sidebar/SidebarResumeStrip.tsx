import React, { useMemo } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortActivityAgeLabel } from './ShortActivityAgeLabel'
import { resolveResumeStripTarget } from './resume-strip-target'

/** One line under the Projects header naming the workspace a restore brought back (ORCA-1216 §8). */
export const SidebarResumeStrip = React.memo(
  function SidebarResumeStrip(): React.JSX.Element | null {
    // Why: this memo boundary needs its own language subscription, like SidebarHeader.
    useTranslation()
    const workspaceId = useAppStore((s) => s.resumeStripWorkspaceId)
    const repos = useAppStore((s) => s.repos)
    const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
    const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
    const projectGroups = useAppStore((s) => s.projectGroups)
    const dismissResumeStrip = useAppStore((s) => s.dismissResumeStrip)
    const target = useMemo(
      () =>
        workspaceId
          ? resolveResumeStripTarget({
              workspaceId,
              repos,
              worktreesByRepo,
              folderWorkspaces,
              projectGroups
            })
          : null,
      [workspaceId, repos, worktreesByRepo, folderWorkspaces, projectGroups]
    )
    if (!target) {
      return null
    }
    const dismissLabel = translate('auto.components.sidebar.SidebarResumeStrip.dismiss', 'Dismiss')
    const targetText = [target.projectName, target.workspaceName].filter(Boolean).join(' · ')

    return (
      <div
        data-resume-strip=""
        className="mx-2 mb-1.5 mt-0.5 flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--status-info)_45%,var(--worktree-sidebar-border))] bg-[color-mix(in_srgb,var(--status-info)_9%,var(--worktree-sidebar))] px-[9px] py-[7px] text-[12.5px] leading-none text-foreground"
      >
        <button
          type="button"
          data-resume-strip-open=""
          className="grid min-w-0 flex-1 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
          onClick={() => {
            activateAndRevealWorkspace(target.workspaceId)
            dismissResumeStrip()
          }}
        >
          <RotateCcw className="size-3.5 text-status-info" aria-hidden />
          <span className="min-w-0 truncate">
            <span data-resume-strip-label="" className="font-semibold">
              {translate('auto.components.sidebar.SidebarResumeStrip.resume', 'Resume')}
            </span>{' '}
            <span data-resume-strip-target="">{targetText}</span>
          </span>
          <ShortActivityAgeLabel since={target.lastActivityAt} />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-resume-strip-dismiss=""
              aria-label={dismissLabel}
              className="flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={dismissResumeStrip}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {dismissLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    )
  }
)
