import { gameHostMemoryIsLow, type GameHostCapacity } from './orchestrator-game-host-capacity'
import type { GameGitHubBudget } from './orchestrator-game-github-budget'
import type { GameProjectItem, GameQueueEntry } from './orchestrator-game-project-work'
import type { OrchestratorGameState } from './orchestrator-game-state'
import { teamListActionOf } from './team-panel-list-action'
import type {
  TeamHost,
  TeamMachine,
  TeamMemberCard,
  TeamPrList,
  TeamPrRow,
  TeamQueueEntry,
  TeamSection,
  TeamStatus
} from './team-panel-model-types'

/** Words a client supplies, since the model holds facts and each client translates. */
export type TeamPrFailureTexts = {
  providerFailed: string
  githubLimit: (minutes: number) => string
}

const HOUR_MS = 60 * 60_000
const LONG_QUEUE_WAIT_MS = HOUR_MS

const STATUS_RANK: Record<TeamStatus, number> = {
  attention: 0,
  risk: 1,
  working: 2,
  done: 3,
  idle: 4
}

// Why failed first: red outranks amber, and a conflict can wait for the fix a red check needs.
function verdictOf(item: GameProjectItem): Pick<TeamPrRow, 'status' | 'reason'> {
  if (item.status === 'failure') {
    return { status: 'attention', reason: 'checksFailed' }
  }
  if (item.reviewBlock === 'conflict') {
    return { status: 'risk', reason: 'conflict' }
  }
  if (item.reviewBlock === 'draft') {
    return { status: 'idle', reason: 'draft' }
  }
  if (item.status === 'pending') {
    return { status: 'working', reason: 'inReview' }
  }
  if (item.status === 'success') {
    return { status: 'done', reason: 'ready' }
  }
  // Why: GitLab rows carry no CI and a failed read is `none`; neither may read as passing.
  return { status: 'idle', reason: 'checksUnknown' }
}

function failureOf(
  budget: GameGitHubBudget | undefined,
  texts: TeamPrFailureTexts,
  now: number
): string {
  const spent = [budget?.graphql, budget?.core].find((one) => one?.limit && one.remaining === 0)
  return spent
    ? texts.githubLimit(Math.max(1, Math.ceil((spent.resetAt * 1000 - now) / 60_000)))
    : texts.providerFailed
}

/** Null hides the tab: turned off, or a folder workspace with no remote to review on. */
export function teamPrSectionOf(args: {
  state: OrchestratorGameState
  members: readonly TeamMemberCard[]
  isFolder: boolean
  texts: TeamPrFailureTexts
  now: number
}): TeamSection<TeamPrList> | null {
  const { state, members } = args
  if (args.isFolder || state.panel?.tabs.prs === false) {
    return null
  }
  if (!state.project) {
    return { kind: 'unavailable' }
  }
  const list = state.project.reviews
  if (!list) {
    return { kind: 'error', message: failureOf(state.githubBudget, args.texts, args.now) }
  }
  const rows = list.items
    .map(
      (item): TeamPrRow => ({
        // Why the id as sent: GitHub says #12 and GitLab !12.
        label: item.id,
        number: Number(item.id.replace(/^\D+/, '')) || 0,
        title: item.title,
        url: item.url,
        memberKey: members.find((one) => one.pr?.url === item.url)?.paneKey ?? null,
        ...verdictOf(item)
      })
    )
    .map((row, index) => ({ row, index }))
    .sort((a, b) => STATUS_RANK[a.row.status] - STATUS_RANK[b.row.status] || a.index - b.index)
    .map(({ row }) => row)
  return {
    kind: 'ready',
    value: {
      rows,
      total: list.total,
      listUrl: list.url,
      listAction: teamListActionOf(list, state.actions ?? [])
    }
  }
}

function queueEntryOf(
  entry: GameQueueEntry,
  members: readonly TeamMemberCard[],
  now: number
): TeamQueueEntry {
  const waited = entry.since === null ? 0 : now - entry.since
  const stuck = entry.state === 'waiting' && waited >= LONG_QUEUE_WAIT_MS
  return {
    label: entry.id,
    title: entry.title,
    url: entry.url,
    position: entry.position,
    state: entry.state,
    status:
      entry.state === 'failed'
        ? 'attention'
        : entry.state === 'checks'
          ? 'working'
          : stuck
            ? 'risk'
            : 'idle',
    since: entry.since,
    longWaitHours: stuck ? Math.floor(waited / HOUR_MS) : null,
    memberKey: members.find((one) => one.pr?.url === entry.url)?.paneKey ?? null
  }
}

/** Null hides the tab; no queue is unavailable, because an empty one would claim nothing waits. */
export function teamQueueSectionOf(args: {
  state: OrchestratorGameState
  members: readonly TeamMemberCard[]
  isFolder: boolean
  texts: TeamPrFailureTexts
  now: number
}): TeamSection<TeamQueueEntry[]> | null {
  const { state, members, now } = args
  if (args.isFolder || state.panel?.tabs.queue === false) {
    return null
  }
  const queue = state.project?.queue
  if (!queue) {
    return { kind: 'unavailable' }
  }
  if (!queue.entries) {
    return { kind: 'error', message: failureOf(state.githubBudget, args.texts, now) }
  }
  return { kind: 'ready', value: queue.entries.map((one) => queueEntryOf(one, members, now)) }
}

function hostOf(one: GameHostCapacity, members: readonly TeamMemberCard[]): TeamHost {
  if (one.host === 'local') {
    return { kind: 'local' }
  }
  const known = members.find((card) => card.host.kind === 'remote' && card.host.name === one.host)
  return {
    kind: 'remote',
    name: one.host,
    environmentId: known?.host.kind === 'remote' ? known.host.environmentId : null,
    reachable: one.status === 'ok'
  }
}

function machineOf(one: GameHostCapacity, members: readonly TeamMemberCard[]): TeamMachine {
  const base = { host: hostOf(one, members), running: one.running, cap: one.cap ?? null }
  if (one.status === 'unreachable') {
    return { ...base, status: 'attention', reading: { kind: 'unreachable', lastSeenAt: null } }
  }
  return {
    ...base,
    status: gameHostMemoryIsLow(one) ? 'risk' : one.running > 0 ? 'working' : 'idle',
    reading: {
      kind: 'ok',
      cpuCoreCount: one.cpuCoreCount,
      totalMemory: one.totalMemory,
      availableMemory: one.availableMemory,
      loadAverage1m: one.loadAverage1m
    }
  }
}

/** Null hides the tab; a lead with no paired host reads this machine alone, an older host unavailable. */
export function teamMachinesSectionOf(args: {
  state: OrchestratorGameState
  members: readonly TeamMemberCard[]
}): TeamSection<TeamMachine[]> | null {
  const { state, members } = args
  if (state.panel?.tabs.machines === false) {
    return null
  }
  const hosts = state.hostCapacity ?? (state.localHost ? [state.localHost] : null)
  if (hosts) {
    return { kind: 'ready', value: hosts.map((one) => machineOf(one, members)) }
  }
  return state.hosts ? { kind: 'ready', value: [] } : { kind: 'unavailable' }
}
