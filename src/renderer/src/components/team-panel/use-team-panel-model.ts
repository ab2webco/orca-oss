import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/store'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import {
  openQuestionCountOf,
  useOtherGameInboxGroups
} from '@/components/game-inbox/use-other-game-inbox-groups'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type {
  TeamMemberCard,
  TeamPanelModel,
  TeamSection
} from '../../../../shared/team-panel-model-types'
import {
  findTeamLeadCaller,
  readTeamLeadState,
  readTeamLeads,
  readTeamOwnerQuestions
} from './team-panel-lead-read'
import { teamPanelModelOf } from './team-panel-model-of'
import { createTeamPanelModelPoller, type TeamPanelScope } from './team-panel-model-poll'
import { withOtherProjectQuestions } from './team-panel-inbox-overlay'
import { onGameOwnerQuestionsChanged } from '@/components/game-inbox/game-owner-questions-signal'

export type TeamPanelModelSource = {
  section: TeamSection<TeamPanelModel>
  /** Null when there is nothing to retry. */
  retry: (() => void) | null
}

// Why 20 s: the same cadence as the mobile Team drawer, which polls the same game.state cache.
const TEAM_REFRESH_MS = 20_000
const NO_WORKSPACE: TeamPanelModelSource = { section: { kind: 'unavailable' }, retry: null }

const useTeamPanelModelStore = create<{ source: TeamPanelModelSource }>(() => ({
  source: { section: { kind: 'loading' }, retry: null }
}))

function worktreeIdOfTab(tabId: string): string | null {
  for (const [worktreeId, tabs] of Object.entries(useAppStore.getState().tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

const poller = createTeamPanelModelPoller(
  {
    readLeads: readTeamLeads,
    findCaller: (leads, scope) =>
      findTeamLeadCaller({
        leads,
        entries: useAppStore.getState().agentStatusByPaneKey,
        worktreeIdOfTab,
        repoWorktreeIds: scope.worktreeIds
      }),
    readState: readTeamLeadState,
    readQuestions: readTeamOwnerQuestions,
    modelOf: teamPanelModelOf,
    publish: (source) => useTeamPanelModelStore.setState({ source })
  },
  TEAM_REFRESH_MS
)

/**
 * The Team panel's only data source: the lead's own game.state for the active project.
 * Why one poller: the activity bar and the panel both call this hook.
 */
export function useTeamPanelModel(): TeamPanelModelSource {
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const repoId = useAppStore((s) =>
    s.activeWorktreeId ? (s.getKnownWorktreeById(s.activeWorktreeId)?.repoId ?? null) : null
  )
  const projectName = useAppStore(
    (s) => s.repos.find((repo) => repo.id === repoId)?.displayName ?? null
  )
  // Why joined: a string keeps the selector stable across unrelated store writes.
  const worktreeIdList = useAppStore((s) =>
    repoId ? (s.worktreesByRepo[repoId] ?? []).map((one) => one.id).join('\n') : ''
  )
  const scope = useMemo<TeamPanelScope | null>(
    () =>
      repoId && projectName
        ? {
            key: `${hostId ?? 'local'}|${repoId}`,
            target: gameInboxTargetOf(hostId),
            repoId,
            projectName,
            worktreeIds: new Set(worktreeIdList.split('\n').filter(Boolean))
          }
        : null,
    [hostId, projectName, repoId, worktreeIdList]
  )
  useEffect(() => (scope ? poller.subscribe(scope) : undefined), [scope])
  // Why: an answer changes the Inbox count now, not at the next 20 s read.
  useEffect(() => {
    if (!scope) {
      return
    }
    const refreshNow = (): void => poller.refresh()
    const stopLocal = window.api.runtime.onGameOwnerQuestionsChanged?.(refreshNow)
    const stopPaired = onGameOwnerQuestionsChanged(refreshNow)
    return () => {
      stopLocal?.()
      stopPaired()
    }
  }, [scope])
  const source = useTeamPanelModelStore((s) => s.source)
  const otherOpen = openQuestionCountOf(useOtherGameInboxGroups())
  return useMemo(() => {
    if (!scope) {
      return NO_WORKSPACE
    }
    const { section } = source
    if (otherOpen === 0 || section.kind !== 'ready') {
      return source
    }
    const model = section.value
    const value = { ...model, inbox: withOtherProjectQuestions(model.inbox, otherOpen) }
    return { ...source, section: { kind: 'ready', value } }
  }, [scope, source, otherOpen])
}

/**
 * The last model kind any open panel read, for the activity bar's icon. Never polls: the bar is
 * always mounted, and game.state reads reviews and metrics on the host.
 */
export function useTeamPanelKind(): TeamPanelModel['kind'] | null {
  return useTeamPanelModelStore((s) =>
    s.source.section.kind === 'ready' ? s.source.section.value.kind : null
  )
}

/** The member whose pane is in this terminal tab, from the last model the panel read; never polls. */
export function useTeamMemberOfTab(tabId: string): TeamMemberCard | null {
  return useTeamPanelModelStore((s) => {
    const section = s.source.section
    if (section.kind !== 'ready' || section.value.kind !== 'team') {
      return null
    }
    // Why local only: a paired host's pane key names a tab on that host, not in this window.
    return (
      section.value.members.find(
        (card) => card.host.kind === 'local' && parsePaneKey(card.paneKey)?.tabId === tabId
      ) ?? null
    )
  })
}
