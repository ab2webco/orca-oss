import {
  gameAgentOf,
  gameReviewOf,
  statusGroupOfName,
  type GameActivity,
  type GameAgent,
  type GameMemberAccount,
  type GameMemberWorktree,
  type GameStatusGroup,
  type GameWorkItem
} from '../../shared/orchestrator-game-state'
import type { GameMemberLimit } from '../../shared/orchestrator-game-member-limit'
import type { GameMemberAdvisor } from '../../shared/orchestrator-game-member-advisor'
import type { GameMemberLaunch } from '../../shared/orchestrator-game-member-launch'
import type { RuntimeWorktreeAgentRow } from '../../shared/runtime-types'
import type { WorkspaceLinkedItem } from '../../shared/worktree/types'

export type GameAgentRow = Pick<
  RuntimeWorktreeAgentRow,
  | 'paneKey'
  | 'state'
  | 'agentType'
  | 'displayName'
  | 'taskTitle'
  | 'toolName'
  | 'lastActivityAt'
  | 'orphaned'
> & { parentPaneKey?: string | null; stateStartedAt?: number }

/** The account a member's agent runs on, read from its live pane and its worktree's pin. */
export type GameMemberAccountOf = (member: {
  paneKey: string
  agentType: string | null
  worktreeId: string | null
}) => GameMemberAccount | null

/** Whether a member runs on the host's global login instead of a managed account. */
export type GameMemberGlobalLoginOf = (member: {
  paneKey: string
  agentType: string | null
  worktreeId: string | null
}) => boolean

/** Whether a stopped member hit its account's usage limit; read only for members. */
export type GameMemberLimitOf = (member: {
  paneKey: string
  agentType: string | null
  state: GameAgent['state']
  account: GameMemberAccount | null
}) => Promise<GameMemberLimit | null>

export type ReadLinkedStatus = (
  linked: WorkspaceLinkedItem
) => Promise<{ name: string; group?: GameStatusGroup } | null>

/** A member worktree's own review and linked ticket, as the lead's are read. */
export type GameMemberWork = {
  review: Parameters<typeof gameReviewOf>[0]
  linkedWorkItem: WorkspaceLinkedItem | null | undefined
}

// Why: a tracker that is offline or unauthenticated must cost the game its badge, never the whole state.
export const settle = <T>(read: () => Promise<T | null>): Promise<T | null> =>
  read().catch(() => null)

export function linkedItemOf(linked: WorkspaceLinkedItem | null | undefined): GameWorkItem | null {
  if (!linked || linked.type !== 'issue') {
    return null
  }
  const identifier =
    linked.jiraIdentifier ??
    linked.linearIdentifier ??
    linked.planeIdentifier ??
    `#${linked.number}`
  return {
    provider: linked.provider,
    identifier,
    title: linked.title,
    url: linked.url,
    status: '',
    statusGroup: 'unknown'
  }
}

/** The linked ticket with its live status, or without one when its tracker does not answer. */
export async function liveLinkedItemOf(
  linked: WorkspaceLinkedItem | null | undefined,
  readLinkedStatus: ReadLinkedStatus | undefined
): Promise<GameWorkItem | null> {
  const item = linkedItemOf(linked)
  const live =
    item && linked && readLinkedStatus ? await settle(() => readLinkedStatus(linked)) : null
  return item && live
    ? { ...item, status: live.name, statusGroup: live.group ?? statusGroupOfName(live.name) }
    : item
}

/** The calling Team plus every session the lead launched, with each member's own PR and ticket. */
export async function gameFleetOf(args: {
  agents: readonly GameAgentRow[]
  members: readonly { row: GameAgentRow; worktree: GameMemberWorktree }[]
  /** Other sessions on this machine, which no `game launch` started (ORCA-914). */
  found?: readonly { row: GameAgentRow; worktree: GameMemberWorktree }[]
  leaderPaneKey: string | null
  teamHandles: ReadonlySet<string> | null | undefined
  terminalHandleOf: ((paneKey: string) => string | null) | undefined
  activityOf: (paneKey: string) => GameActivity | null
  readMemberWork: ((worktreeId: string) => Promise<GameMemberWork | null>) | undefined
  readLinkedStatus: ReadLinkedStatus | undefined
  accountOf?: GameMemberAccountOf
  globalLoginOf?: GameMemberGlobalLoginOf
  limitOf?: GameMemberLimitOf
  /** What a member pane's own Jev last reported; read only for members. */
  advisorOf?: (paneKey: string) => GameMemberAdvisor | null
  /** The model and effort Orca dispatched a member on; read only for members. */
  launchOf?: (paneKey: string) => GameMemberLaunch | null
  /** The lead's worktree, where a member without one of its own runs. */
  leadWorktreeId?: string | null
}): Promise<GameAgent[]> {
  const { leaderPaneKey, teamHandles } = args
  const isMemberRow = (row: GameAgentRow): boolean =>
    leaderPaneKey !== null && row.parentPaneKey === leaderPaneKey
  // Why: a member reports to this lead wherever it runs; another lead's member is never ours.
  const rows = teamHandles
    ? args.agents.filter((row) => {
        const handle = args.terminalHandleOf?.(row.paneKey)
        return (
          isMemberRow(row) || (handle !== null && handle !== undefined && teamHandles.has(handle))
        )
      })
    : // Why the caller's own row: a member pane has a parent, and its band names it from this row.
      args.agents.filter(
        (row) => !row.parentPaneKey || isMemberRow(row) || row.paneKey === leaderPaneKey
      )
  const listed = new Set([
    ...rows.map((row) => row.paneKey),
    ...(leaderPaneKey ? [leaderPaneKey] : [])
  ])
  const launched = args.members.filter((one) => !listed.has(one.row.paneKey))
  for (const one of launched) {
    listed.add(one.row.paneKey)
  }
  const sourced = [
    ...rows.map((row) => ({ row, worktree: undefined, found: false })),
    ...launched.map((one) => ({ ...one, found: false })),
    ...(args.found ?? [])
      .filter((one) => !listed.has(one.row.paneKey))
      .map((one) => ({ ...one, found: true }))
  ]
  const readMemberWork = args.readMemberWork
  return await Promise.all(
    sourced.map(async ({ row, worktree, found }) => {
      const work =
        worktree && readMemberWork ? await settle(() => readMemberWork(worktree.id)) : null
      const review = work ? gameReviewOf(work.review) : null
      const workItem = work
        ? await liveLinkedItemOf(work.linkedWorkItem, args.readLinkedStatus)
        : null
      const activity = args.activityOf(row.paneKey)
      const isMember = isMemberRow(row) || worktree !== undefined
      const seat = {
        paneKey: row.paneKey,
        agentType: row.agentType,
        worktreeId: worktree?.id ?? args.leadWorktreeId ?? null
      }
      const account = isMember ? (args.accountOf?.(seat) ?? null) : null
      const globalLogin = isMember && account === null && args.globalLoginOf?.(seat) === true
      const agent = gameAgentOf(row, leaderPaneKey, args.terminalHandleOf?.(row.paneKey) ?? null)
      const limitOf = args.limitOf
      const limit =
        isMember && limitOf
          ? await settle(() =>
              limitOf({
                paneKey: row.paneKey,
                agentType: row.agentType,
                state: agent.state,
                account
              })
            )
          : null
      const advisor = isMember ? (args.advisorOf?.(row.paneKey) ?? null) : null
      const launch = isMember ? (args.launchOf?.(row.paneKey) ?? null) : null
      return {
        ...agent,
        // Why the worktree's name: outside a dispatch a row has no task title to show.
        ...(found ? { displayName: agent.displayName ?? worktree?.displayName ?? null } : {}),
        ...(isMember ? { isMember: true } : {}),
        ...(found ? { found: true as const } : {}),
        ...(worktree ? { worktree } : {}),
        ...(review ? { review } : {}),
        ...(workItem ? { workItem } : {}),
        ...(activity ? { activity } : {}),
        ...(account ? { account } : {}),
        ...(globalLogin ? { globalLogin: true as const } : {}),
        ...(limit ? { limit } : {}),
        ...(advisor ? { advisor } : {}),
        ...(launch ? { launch } : {}),
        ...(isMember && row.lastActivityAt ? { lastActivityAt: row.lastActivityAt } : {}),
        ...(isMember && row.stateStartedAt ? { stateSince: row.stateStartedAt } : {}),
        ...(isMember && row.orphaned ? { orphaned: true as const } : {})
      }
    })
  )
}
