import type { CommandHandler } from '../dispatch'
import { gameBoardCaller } from './orchestrator-game-board-call'
import type { GameDecision, GameDecisionList } from '../../shared/orchestrator-game-decisions'
import type { GameOwnerQuestion } from '../../shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import {
  gameFleetReportOf,
  type GameFleet,
  type GameFleetRow
} from '../../shared/orchestrator-game-fleet-verbs'
import { gameHostLoadLineOf } from '../../shared/orchestrator-game-host-load'
import { waitingOnYouNextOf } from '../../shared/orchestrator-game-lead-wait'

type Client = Parameters<CommandHandler>[0]['client']

/** What a lead takes over on `game lead`: one line per item, built from the fleet and the project record (ORCA-1429). */
export type GameInherited = {
  slots: string
  running: string[]
  /** Finished members whose pane is still open, each with the command that closes it. */
  finished: string[]
  leftovers: string[]
  paused: string[]
  /** Who waits on whom: members on the lead, the lead on the person. */
  waiting: string[]
  followUps: string[]
  decisions: string[]
  decisionsTotal: number
  /** Records this Orca could not read, such as the decision trail on an Orca from before ORCA-1428. */
  unread: string[]
}

type OwnerQuestionsRead = { questions: GameOwnerQuestion[]; undelivered?: GameOwnerQuestion[] }

const RECENT_DECISIONS = 5
const TEXT_MAX = 100

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1)}…` : line
}

const nameOf = (row: GameFleetRow): string => row.ticket ?? row.name
const labelOf = (row: GameFleetRow): string => `${nameOf(row)}${row.host ? ` on ${row.host}` : ''}`
const ticketTag = (ticket: string | null): string => (ticket ? ` ${ticket}` : '')

function membersOf(fleet: GameFleet): Pick<GameInherited, 'running' | 'finished' | 'leftovers'> {
  const leftovers = fleet.rows.filter((row) => row.leftover)
  const finished = fleet.rows.filter((row) => !row.leftover && row.phase === 'finished')
  const running = fleet.rows.filter((row) => !row.leftover && row.phase !== 'finished')
  return {
    running: running.map(
      (row) =>
        `${labelOf(row)}: ${row.phase}${row.review ? `, PR ${row.review}` : ''}; next: ${row.next}`
    ),
    // Why no found one here: a found session that is not working is a leftover, with its own close.
    finished: finished.map(
      (row) =>
        `${labelOf(row)}: ${row.review ? `PR ${row.review}` : 'done'}; orca game sweep --close`
    ),
    leftovers: leftovers.map((row) => `${nameOf(row)}: ${row.next}`)
  }
}

function waitingOf(
  state: Pick<OrchestratorGameState, 'inboxes'>,
  owner: OwnerQuestionsRead | null,
  now: number
): string[] {
  const onLead = state.inboxes?.find((inbox) => inbox.key === 'lead')?.waiting ?? []
  return [
    ...onLead.map(
      (wait) => `${wait.from} ${waitingOnYouNextOf(wait, now)} ("${clip(wait.subject)}")`
    ),
    ...(owner?.questions ?? [])
      .filter((one) => !one.answer)
      .map(
        (one) =>
          `you wait on the person: ${one.id}${ticketTag(one.ticket)} ${clip(one.question)} (asked ${one.askedAt})`
      ),
    ...(owner?.undelivered ?? []).map(
      (one) =>
        `the person answered ${one.id}${ticketTag(one.ticket)}: ${clip(one.answer?.text ?? '')}; act on it`
    )
  ]
}

const decisionLine = (one: GameDecision): string =>
  `${one.at.slice(0, 16)} ${one.id}${ticketTag(one.ticket)}: ${clip(one.decision)}`

export function gameInheritedOf(
  state: Parameters<typeof gameFleetReportOf>[0],
  owner: OwnerQuestionsRead | null,
  trail: GameDecisionList | null,
  now = Date.now()
): GameInherited {
  const fleet = gameFleetReportOf(state, now)
  const hosts = fleet.hosts ? ` · ${gameHostLoadLineOf(fleet.hosts)}` : ''
  return {
    slots: `${fleet.running}/${fleet.cap} running, ${fleet.free} free${hosts}`,
    ...membersOf(fleet),
    paused: fleet.paused.map(
      (one) =>
        `${one.ticket}: paused since ${one.since}; orca game resume-members ${one.ticket}${one.worktreeGone ? ' --discard (worktree gone)' : ''}`
    ),
    waiting: waitingOf(state, owner, now),
    followUps: (trail?.followUps ?? []).map(decisionLine),
    decisions: (trail?.decisions ?? []).slice(0, RECENT_DECISIONS).map(decisionLine),
    decisionsTotal: trail?.total ?? 0,
    unread: [...(owner ? [] : ['owner questions']), ...(trail ? [] : ['decisions'])]
  }
}

const isOwnerRead = (value: unknown): value is OwnerQuestionsRead =>
  Array.isArray((value as OwnerQuestionsRead | null)?.questions)

const isTrail = (value: unknown): value is GameDecisionList =>
  Array.isArray((value as GameDecisionList | null)?.followUps) &&
  Array.isArray((value as GameDecisionList | null)?.decisions)

// Why quiet: an Orca without the record, or one that fails, must still print the brief.
async function readBoard<T>(
  client: Client,
  method: string,
  valid: (value: unknown) => value is T
): Promise<T | null> {
  const result = await client
    .call<unknown>(method, gameBoardCaller())
    .then((one) => one.result)
    .catch(() => null)
  return valid(result) ? result : null
}

export async function readGameInherited(
  client: Client,
  state: Parameters<typeof gameFleetReportOf>[0]
): Promise<GameInherited> {
  const [owner, trail] = await Promise.all([
    readBoard(client, 'game.ownerQuestions', isOwnerRead),
    readBoard(client, 'game.decisions', isTrail)
  ])
  return gameInheritedOf(state, owner, trail)
}

const group = (head: string, lines: readonly string[]): string[] =>
  lines.length === 0 ? [] : [`${head} (${lines.length}):`, ...lines.map((line) => `  ${line}`)]

export function formatGameInherited(inherited: GameInherited): string {
  const { decisions, decisionsTotal: total } = inherited
  const recent = decisions.length < total ? `latest ${decisions.length} of ${total}` : `${total}`
  const body = [
    ...group('Running', inherited.running),
    ...group('Finished, pane still open', inherited.finished),
    ...group('Leftovers, no slot held', inherited.leftovers),
    ...group('Paused', inherited.paused),
    ...group('Waiting', inherited.waiting),
    ...group('Pending follow-ups, close with orca game decision done <id>', inherited.followUps),
    ...(decisions.length > 0
      ? [
          `Recent decisions (${recent}, orca game decision list):`,
          ...decisions.map((d) => `  ${d}`)
        ]
      : [])
  ]
  return [
    'Inherited (from the fleet and the project record):',
    `Slots: ${inherited.slots}`,
    ...(body.length > 0 ? body : ['Nothing running, finished, left over, waiting or decided yet.']),
    ...(inherited.unread.length > 0
      ? [`Not read from this Orca: ${inherited.unread.join(', ')}; update Orca Lab if it is older.`]
      : [])
  ].join('\n')
}
