import React from 'react'
import { AlertTriangle } from 'lucide-react'

import { translate } from '@/i18n/i18n'
import { LinearAgentSkillSetupPrompt } from './LinearAgentSkillSetupPrompt'
import WorktreeCardAgents from './WorktreeCardAgents'
import { WorktreeStallBanner } from './WorktreeStallBanner'
import { WorktreeLineageChildChip } from './worktree-lineage-child-chip'
import type { WorktreeCardPresentation } from './worktree-card-presentation'
import type { WorktreeCardController } from './use-worktree-card-controller'

export function WorktreeCardSecondaryRows({
  card,
  presentation
}: {
  card: WorktreeCardController
  presentation: WorktreeCardPresentation
}): React.JSX.Element {
  const {
    worktree,
    repo,
    settings,
    isActive,
    newCardStyle,
    lineageChildren,
    lineageCollapsed,
    onLineageToggle,
    remoteBranchConflict,
    showInlineAgentList,
    agentActivityDisplayMode,
    compactInlineAgentRows,
    showLineageChildChip,
    lineageChildAriaLabel,
    childWorkspaceShortLabel
  } = card
  const { hasMetaRow } = presentation

  return (
    <>
      {remoteBranchConflict && (
        <div className="mt-0.5 flex items-start gap-1.5 rounded border border-status-warning/25 bg-status-warning/5 px-1.5 py-1 text-[10.5px] leading-snug text-status-warning">
          <AlertTriangle className="mt-[1px] size-3 shrink-0" />
          <span className="min-w-0 flex-1">
            {translate(
              'auto.components.sidebar.WorktreeCard.a88c92d0e3',
              '{{value0}}/{{value1}} already exists.',
              {
                value0: remoteBranchConflict.remote,
                value1: remoteBranchConflict.branchName
              }
            )}
          </span>
        </div>
      )}

      {isActive && worktree.linkedLinearIssue ? (
        <LinearAgentSkillSetupPrompt
          linked
          remote={Boolean(repo?.connectionId || settings?.activeRuntimeEnvironmentId?.trim())}
          surface="modal"
          settings={settings}
        />
      ) : null}

      {/* Outside the agent list on purpose: a pane whose process died renders no agent row. */}
      <WorktreeStallBanner worktreeId={worktree.id} />

      {/* Why: counterbalance the card stack gap (-mt-1) so agents right after the title read as one header group. */}
      {showInlineAgentList && (
        <WorktreeCardAgents
          worktreeId={worktree.id}
          agents={agentActivityDisplayMode === 'compact' ? compactInlineAgentRows : undefined}
          className={hasMetaRow || remoteBranchConflict ? 'mt-0' : '-mt-1'}
        />
      )}

      {showLineageChildChip && (
        <WorktreeLineageChildChip
          newCardStyle={newCardStyle}
          collapsed={lineageCollapsed}
          ariaLabel={lineageChildAriaLabel}
          shortLabel={childWorkspaceShortLabel}
          onToggle={onLineageToggle}
        />
      )}

      {!newCardStyle && lineageChildren && (
        <div className="-ml-[1.125rem] mt-1.5 w-[calc(100%+1.125rem)] space-y-1">
          {lineageChildren}
        </div>
      )}
    </>
  )
}
