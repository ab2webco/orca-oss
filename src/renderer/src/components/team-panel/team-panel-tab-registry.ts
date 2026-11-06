import { translate } from '@/i18n/i18n'
import type {
  TeamPanelModel,
  TeamSection,
  TeamTabId
} from '../../../../shared/team-panel-model-types'
import {
  defineTeamPanelTab,
  type TeamPanelResolvedTab,
  type TeamPanelTabDefinition
} from './team-panel-tab-definition'
import { TeamPanelActivityTab } from './team-panel-activity-tab'
import { TeamPanelInboxTab } from './team-panel-inbox-tab'
import { TeamPanelMachinesTab } from './team-panel-machines-tab'
import { TeamPanelPrsTab } from './team-panel-prs-tab'
import { TeamPanelQueueTab } from './team-panel-queue-tab'
import { TeamPanelTeamTab } from './team-panel-team-tab'

const ready = <V>(value: V): TeamSection<V> => ({ kind: 'ready', value })
const isEmptyList = (rows: readonly unknown[]): boolean => rows.length === 0

// Why: one entry per tab, in the design's order; each body lives in its own file so the
// members drawing Inbox, PRs, Queue, Machines and Activity never edit this list.
const TEAM_PANEL_TABS: readonly TeamPanelTabDefinition[] = [
  defineTeamPanelTab({
    id: 'team',
    title: () => translate('teamPanel.tabs.team.title', 'Team'),
    section: (model) => (model.kind === 'team' ? ready(model) : null),
    // The lead is always its first card.
    isEmpty: () => false,
    copy: () => ({
      emptyTitle: translate('teamPanel.tabs.team.emptyTitle', 'No agents yet'),
      emptyText: translate(
        'teamPanel.tabs.team.emptyText',
        'Launch one from a ticket and it shows here.'
      ),
      errorTitle: translate('teamPanel.tabs.team.errorTitle', 'Could not read the team')
    }),
    Body: TeamPanelTeamTab
  }),
  defineTeamPanelTab({
    id: 'activity',
    title: () => translate('teamPanel.tabs.activity.title', 'Activity'),
    section: (model) => (model.kind === 'solo' ? ready(model) : null),
    isEmpty: (model) => model.rows.length === 0,
    copy: () => ({
      emptyTitle: translate('teamPanel.tabs.activity.emptyTitle', 'No agents running'),
      emptyText: translate(
        'teamPanel.tabs.activity.emptyText',
        'Start an agent in any workspace and it shows here.'
      ),
      errorTitle: translate('teamPanel.tabs.activity.errorTitle', 'Could not read your sessions')
    }),
    Body: TeamPanelActivityTab
  }),
  defineTeamPanelTab({
    id: 'inbox',
    title: () => translate('teamPanel.tabs.inbox.title', 'Inbox'),
    section: (model) => model.inbox,
    isEmpty: (counts) => counts.forYou + counts.waiting + counts.threads + counts.answered === 0,
    count: (model) =>
      model.inbox.kind === 'ready' && model.inbox.value.forYou > 0
        ? model.inbox.value.forYou
        : null,
    copy: () => ({
      emptyTitle: translate('teamPanel.tabs.inbox.emptyTitle', 'Nothing waits for you'),
      emptyText: translate(
        'teamPanel.tabs.inbox.emptyText',
        'When an agent asks you something, it shows here.'
      ),
      errorTitle: translate('teamPanel.tabs.inbox.errorTitle', 'Could not read the inbox')
    }),
    Body: TeamPanelInboxTab
  }),
  defineTeamPanelTab({
    id: 'prs',
    title: () => translate('teamPanel.tabs.prs.title', 'PRs'),
    section: (model) => model.prs,
    isEmpty: isEmptyList,
    copy: () => ({
      emptyTitle: translate('teamPanel.tabs.prs.emptyTitle', 'No open pull requests'),
      emptyText: translate(
        'teamPanel.tabs.prs.emptyText',
        'They show here when an agent opens one.'
      ),
      errorTitle: translate('teamPanel.tabs.prs.errorTitle', 'Could not read pull requests')
    }),
    Body: TeamPanelPrsTab
  }),
  defineTeamPanelTab({
    id: 'queue',
    title: () => translate('teamPanel.tabs.queue.title', 'Queue'),
    section: (model) => model.queue,
    isEmpty: isEmptyList,
    copy: () => ({
      emptyTitle: translate('teamPanel.tabs.queue.emptyTitle', 'The queue is empty'),
      emptyText: translate(
        'teamPanel.tabs.queue.emptyText',
        'Each pull request shows here in order until it merges.'
      ),
      errorTitle: translate('teamPanel.tabs.queue.errorTitle', 'Could not read the queue')
    }),
    Body: TeamPanelQueueTab
  }),
  defineTeamPanelTab({
    id: 'machines',
    title: () => translate('teamPanel.tabs.machines.title', 'Machines'),
    section: (model) => model.machines,
    isEmpty: isEmptyList,
    copy: () => ({
      emptyTitle: translate('teamPanel.tabs.machines.emptyTitle', 'Only this machine'),
      emptyText: translate(
        'teamPanel.tabs.machines.emptyText',
        'Pair another machine to spread agents across hosts.'
      ),
      errorTitle: translate('teamPanel.tabs.machines.errorTitle', 'Could not read the machines')
    }),
    Body: TeamPanelMachinesTab
  })
]

export function resolveTeamPanelTabs(model: TeamPanelModel): TeamPanelResolvedTab[] {
  return TEAM_PANEL_TABS.flatMap((tab) => tab.resolve(model) ?? [])
}

/** The stored tab when it is shown, else the first one. */
export function pickTeamPanelTab(
  tabs: readonly TeamPanelResolvedTab[],
  selected: TeamTabId | null
): TeamPanelResolvedTab | null {
  return tabs.find((tab) => tab.id === selected) ?? tabs[0] ?? null
}
