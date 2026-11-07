import { i18n } from '@/i18n/i18n'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/store'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import {
  openQuestionCountOf,
  useOpenGameOwnerQuestionCount,
  useOtherGameInboxGroups
} from '@/components/game-inbox/use-other-game-inbox-groups'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type {
  TeamMemberCard,
  TeamPanelModel,
  TeamSection
} from '../../../../shared/team-panel-model-types'
import {
  findTeamLeadCaller,
  readTeamLeadRoster,
  readTeamLeadState,
  readTeamOwnerQuestions,
  readTeamXp
} from './team-panel-lead-read'
import { teamPanelModelOf } from './team-panel-model-of'
import { isMemberInTab, isRemoteMemberWorktreeActive } from './team-member-tab-match'
import { createTeamPanelModelPoller, type TeamPanelScope } from './team-panel-model-poll'
import { withOtherProjectQuestions } from './team-panel-inbox-overlay'
import { onGameOwnerQuestionsChanged } from '@/components/game-inbox/game-owner-questions-signal'
import { onGameAdvisorChanged } from './game-advisor-signal'
import { useTeamPanelSoloModel } from './use-team-panel-solo-model'

export type TeamPanelModelSource = {
  section: TeamSection<TeamPanelModel>
  /** Null when there is nothing to retry. On a ready section: the read failed, this is the last team. */
  retry: (() => void) | null
}

// Why 20 s: the same cadence as the mobile Team drawer, which polls the same game.state cache.
const TEAM_REFRESH_MS = 20_000

const useTeamPanelModelStore = create<{ source: TeamPanelModelSource }>(() => ({
  source: { section: { kind: 'loading' }, retry: null }
}))

const NO_MEMBERS: readonly TeamMemberCard[] = []
const membersOf = (source: TeamPanelModelSource): readonly TeamMemberCard[] =>
  source.section.kind === 'ready' && source.section.value.kind === 'team'
    ? source.section.value.members
    : NO_MEMBERS

// Why outside the store: a project switch publishes loading, and the hold must outlive it.
let lastTeam: { scope: TeamPanelScope; members: readonly TeamMemberCard[] } | null = null

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
    readLeads: readTeamLeadRoster,
    findCaller: ({ leads, restoring }, scope) =>
      findTeamLeadCaller({
        leads,
        restoring,
        entries: useAppStore.getState().agentStatusByPaneKey,
        worktreeIdOfTab,
        repoWorktreeIds: scope.worktreeIds
      }),
    readState: readTeamLeadState,
    readQuestions: readTeamOwnerQuestions,
    readXp: readTeamXp,
    modelOf: (args) => {
      const repo = useAppStore.getState().repos.find((one) => one.id === args.repoId)
      // Why the resolved language: the setting can be `system`, and roster names come per language.
      const locale = i18n.language.split('-')[0] ?? 'en'
      return teamPanelModelOf({ ...args, isFolder: repo ? isFolderRepo(repo) : false, locale })
    },
    publish: (source, scope) => {
      const members = membersOf(source)
      if (members !== NO_MEMBERS) {
        lastTeam = { scope, members }
      }
      useTeamPanelModelStore.setState({ source })
    }
  },
  TEAM_REFRESH_MS
)

/** Reads the panel again now, after it changed something on the host. */
export const refreshTeamPanelModel = (): void => poller.refresh()

/**
 * No team means the user's own sessions: no lead, no workspace, or a host with no game.
 * Why not an error: a failed read says nothing about the team, and solo rows would hide the failure.
 */
const hasNoTeam = (section: TeamSection<TeamPanelModel>): boolean => section.kind === 'unavailable'

/**
 * The lead's own game.state for the active project, else the no-team view from agent status.
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
  const activeScope = useMemo<TeamPanelScope | null>(
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
  const heldKey = useAppStore((s) =>
    lastTeam && isRemoteMemberWorktreeActive(lastTeam.members, s) ? lastTeam.scope.key : null
  )
  const scope = heldKey !== null && lastTeam?.scope.key === heldKey ? lastTeam.scope : activeScope
  useEffect(() => (scope ? poller.subscribe(scope) : undefined), [scope])
  // Why: an answer changes the Inbox count, and a Jev line the scene's bubble, now, not at the next 20 s read.
  useEffect(() => {
    if (!scope) {
      return
    }
    const refreshNow = (): void => poller.refresh()
    const stops = [
      window.api.runtime.onGameOwnerQuestionsChanged?.(refreshNow),
      onGameOwnerQuestionsChanged(refreshNow),
      window.api.runtime.onGameAdvisorChanged?.(refreshNow),
      onGameAdvisorChanged(refreshNow)
    ]
    return () => stops.forEach((stop) => stop?.())
  }, [scope])
  const source = useTeamPanelModelStore((s) => s.source)
  const otherOpen = openQuestionCountOf(useOtherGameInboxGroups())
  const everyOpen = useOpenGameOwnerQuestionCount()
  const noTeam = !scope || hasNoTeam(source.section)
  const solo = useTeamPanelSoloModel(noTeam)
  return useMemo<TeamPanelModelSource>(() => {
    const noTeamModel = noTeam ? solo : null
    const shown: TeamPanelModelSource = noTeamModel
      ? { section: { kind: 'ready', value: noTeamModel }, retry: null }
      : source
    const { section } = shown
    // Why every project: the no-team model reads agent status, so it misses this project's too.
    const added = noTeamModel ? everyOpen : otherOpen
    if (added === 0 || section.kind !== 'ready') {
      return shown
    }
    const model = section.value
    const value = { ...model, inbox: withOtherProjectQuestions(model.inbox, added) }
    return { ...shown, section: { kind: 'ready', value } }
  }, [noTeam, solo, source, otherOpen, everyOpen])
}

/** The lead's pane as the last model read it, for what the panel sends it. */
export function useTeamLeadHandle(): string | null {
  return useTeamPanelModelStore((s) =>
    s.source.section.kind === 'ready' && s.source.section.value.kind === 'team'
      ? s.source.section.value.lead.terminalHandle
      : null
  )
}

/**
 * The last model kind any open panel read, for the activity bar's icon. Never polls: the bar is
 * always mounted, and game.state reads reviews and metrics on the host.
 */
export function useTeamPanelKind(): TeamPanelModel['kind'] | null {
  return useTeamPanelModelStore((s) =>
    s.source.section.kind === 'ready'
      ? s.source.section.value.kind
      : hasNoTeam(s.source.section)
        ? 'solo'
        : null
  )
}

/** The member whose pane is in this terminal tab, from the last model the panel read; never polls. */
export function useTeamMemberOfTab(tabId: string): TeamMemberCard | null {
  const members = useTeamPanelModelStore((s) => membersOf(s.source))
  const index = useAppStore((s) =>
    s.rightSidebarOpen && s.rightSidebarTab === 'team'
      ? members.findIndex((card) => isMemberInTab(card, tabId, s))
      : -1
  )
  return members[index] ?? null
}
