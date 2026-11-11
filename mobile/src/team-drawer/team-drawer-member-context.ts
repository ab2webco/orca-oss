import type { TerminalOpenTarget } from '../session/host-terminal-open'

type Rec = Record<string, unknown>
type Usage = { session: number | null; weekly: number | null }

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null)

/** What a member row reads from the rest of the lead's game.state. */
export type TeamMemberContext = {
  questionTickets: ReadonlySet<string>
  usage: ReadonlyMap<string, Usage>
  summaries: ReadonlyMap<string, string>
  terminalOf: (raw: Rec, paneKey: string) => TerminalOpenTarget | null
}

function accountUsageOf(metrics: unknown): Map<string, Usage> {
  const accounts =
    isRecord(metrics) && Array.isArray(metrics.claudeAccounts) ? metrics.claudeAccounts : []
  return new Map(
    accounts.flatMap((one) =>
      isRecord(one) && text(one.email)
        ? [
            [
              one.email as string,
              { session: num(one.sessionPercent), weekly: num(one.weeklyPercent) }
            ] as const
          ]
        : []
    )
  )
}

function summariesOf(inboxes: unknown): Map<string, string> {
  const list = Array.isArray(inboxes) ? inboxes : []
  return new Map(
    list.flatMap((one) =>
      isRecord(one) && text(one.key) && isRecord(one.last) && text(one.last.subject)
        ? [[one.key as string, one.last.subject as string] as const]
        : []
    )
  )
}

export function teamMemberContextOf(
  state: Rec,
  questionTickets: ReadonlySet<string>
): TeamMemberContext {
  const leadWorktreeId = isRecord(state.worktree) ? text(state.worktree.id) : null
  return {
    questionTickets,
    usage: accountUsageOf(state.metrics),
    summaries: summariesOf(state.inboxes),
    terminalOf: (raw, paneKey) => {
      // Why: game.state omits a local member's worktree when it is the lead's.
      const worktreeId = (isRecord(raw.worktree) ? text(raw.worktree.id) : null) ?? leadWorktreeId
      const tabId = paneKey.split(':')[0]
      return isRecord(raw.remote) || !worktreeId || !tabId
        ? null
        : { worktreeId, tabId, terminal: text(raw.terminalHandle) }
    }
  }
}
