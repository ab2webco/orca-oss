import React, { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useNow } from '@/components/dashboard/useNow'
import { isWebClientLocation } from '@/lib/web-client-location'
import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import { canPinClaudeAccountToWorktree } from '@/lib/claude-account-runtime-filter'
import { buildWorktreeClaudeAccountChipModel } from './worktree-claude-account-chip-model'
import { teamSoloHostOf } from '@/components/team-panel/team-panel-solo-sessions'
import { SidebarSoloRow } from './SidebarSoloRow'
import { sidebarSoloRowLines, type SidebarSoloAgent } from './sidebar-solo-row'
import {
  activateWorktreeAgentTab,
  dismissWorktreeAgent,
  useWorktreeAgentSendTargets
} from './worktree-agent-row-actions'
import type { WorktreeCardController } from './use-worktree-card-controller'
import type { TeamPullRequest } from '../../../../shared/team-panel-model-types'

/** A worktree with one live agent, drawn as V30's soloRow with the inline list's actions. */
export function WorktreeCardSoloContent({
  card,
  solo
}: {
  card: WorktreeCardController
  solo: SidebarSoloAgent
}): React.JSX.Element {
  const { worktree, repo, workspacePorts, prDisplay } = card
  const properties = useAppStore((s) => s.worktreeCardProperties)
  const flat = useAppStore((s) => s.groupBy !== 'repo')
  const roster = useAppStore((s) => s.claudeAccountRoster)
  const now = useNow(30_000)
  const send = useWorktreeAgentSendTargets(worktree.id)
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
  const remoteHost = useAppStore((s) => {
    const host = teamSoloHostOf(s, worktree, repo)
    return host.kind === 'remote' ? host.name : null
  })
  const lines = useMemo(
    () =>
      sidebarSoloRowLines(solo.agent.entry, {
        properties: properties ?? [],
        flat,
        repoName: repo?.displayName ?? '',
        remoteHost,
        subagents: solo.subagents,
        ports: workspacePorts.map((one) => one.port),
        account: account?.label ?? null
      }),
    [solo, properties, flat, repo?.displayName, remoteHost, workspacePorts, account?.label]
  )
  const showPr = properties?.includes('pr') === true
  const prState = prDisplay?.state
  const prCi = prDisplay?.status
  const pr = useMemo<Pick<TeamPullRequest, 'state' | 'ci'> | null>(
    () => (showPr && prDisplay ? { state: prState ?? 'open', ci: prCi ?? 'none' } : null),
    [showPr, prDisplay, prState, prCi]
  )
  const onActivate = useCallback(
    (tabId: string, paneKey: string) => activateWorktreeAgentTab(worktree.id, tabId, paneKey),
    [worktree.id]
  )
  const target = send.active ? send.targetsByPaneKey.get(solo.agent.paneKey) : undefined
  return (
    <div className="flex w-full min-w-0 flex-col" data-worktree-card-solo-content="">
      <SidebarSoloRow
        agent={solo.agent}
        name={worktree.displayName}
        pr={pr}
        now={now}
        lines={lines}
        onActivate={onActivate}
        onDismiss={dismissWorktreeAgent}
        sendTargetStatus={send.active ? (target?.status ?? 'disabled') : undefined}
        sendTargetDisabledReason={
          send.active ? (target?.disabledReason ?? 'Agent is not available') : undefined
        }
        onSendTargetClick={send.active ? send.onSendTargetClick : undefined}
      />
    </div>
  )
}
