import React from 'react'
import { Bot } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import { canPinClaudeAccountToWorktree } from '@/lib/claude-account-runtime-filter'
import type { Repo, Worktree } from '../../../../shared/types'
import { teamModelText } from '@/components/team-panel/team-card-text'
import { teamSessionModelOf } from '../../../../shared/team-panel-activity-rows'
import CacheTimer, { usePromptCacheCountdownStartedAt } from './CacheTimer'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from './WorktreeCardDetailSection'
import { buildWorktreeClaudeAccountChipModel } from './worktree-claude-account-chip-model'
import { selectLiveAgentStatusEntriesForWorktree } from './worktree-agent-row-selectors'

/** Model, account and cache: what leaves the agent row for the hover card (ORCA-1074). */
export function WorktreeCardAgentHoverDetails({
  worktree,
  repo
}: {
  worktree: Worktree
  repo: Repo | undefined
}): React.JSX.Element | null {
  const models = useAppStore(
    useShallow((s) => {
      const labels = selectLiveAgentStatusEntriesForWorktree(s, worktree.id).map((entry) =>
        teamModelText(teamSessionModelOf(entry))
      )
      return [...new Set(labels.filter((label): label is string => Boolean(label)))]
    })
  )
  const roster = useAppStore((s) => s.claudeAccountRoster)
  const ttlMs = useAppStore((s) => s.settings?.promptCacheTtlMs ?? 0)
  const cacheStartedAt = usePromptCacheCountdownStartedAt(worktree.id)
  const account =
    !isWebClientLocation() && canPinClaudeAccountToWorktree(worktree, repo)
      ? buildWorktreeClaudeAccountChipModel({
          pinnedAccountId: worktree.claudeAccountId,
          wslDistro: getWslDistroFromPath(worktree.path),
          roster,
          systemDefaultLabel: translate(
            'auto.components.sidebar.WorktreeCardClaudeAccountChip.systemDefault',
            'System default'
          )
        })
      : null
  const rows: [string, React.ReactNode][] = []
  if (models.length > 0) {
    rows.push([translate('teamPanel.activity.model', 'Model'), models.join(', ')])
  }
  if (account) {
    rows.push([translate('teamPanel.activity.account', 'Account'), account.label])
  }
  if (cacheStartedAt !== null) {
    rows.push([
      translate('teamPanel.activity.cache', 'Cache'),
      <CacheTimer key="cache" startedAt={cacheStartedAt} ttlMs={ttlMs} />
    ])
  }
  if (rows.length === 0) {
    return null
  }
  return (
    <WorktreeCardDetailSection>
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <Bot className="size-3" />
        <span>{translate('teamPanel.activity.agent', 'Agent')}</span>
      </div>
      <WorktreeCardDetailSectionContent>
        <dl
          data-worktree-agent-hover=""
          className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-1 text-xs"
        >
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0 min-w-0 truncate">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}
