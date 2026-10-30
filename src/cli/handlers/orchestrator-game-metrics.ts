import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  callGameBoard,
  gameBoardCaller,
  optionalText,
  sinceOf
} from './orchestrator-game-board-call'
import { GAME_EVENTS_MAX, parseGameEvent } from '../../shared/orchestrator-game-events'
import { GAME_HISTORY_MAX, parseGameHistoryRecord } from '../../shared/orchestrator-game-history'
import { computeGameMetrics, type GameMetrics } from '../../shared/orchestrator-game-metrics'
import type { GameCharacter } from '../../shared/orchestrator-game-characters'
import {
  gameMetricsSummaryOf,
  type GameMetricsSummary
} from '../../shared/orchestrator-game-metrics-summary'
import {
  desktopGameTimezoneOf,
  isOrchestratorGameTimezone,
  ORCHESTRATOR_GAME_LOCAL_TIMEZONE
} from '../../shared/orchestrator-game-render'

const WIDTH = 80
const LABEL = 15

function untilOf(flags: Map<string, string | boolean>): string | undefined {
  const until = optionalText(flags, 'until')
  if (until !== undefined && Number.isNaN(Date.parse(until))) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--until must be a date like 2026-10-20 or 2026-10-20T09:00, not "${until}".`
    )
  }
  return until
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return '<1m'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours < 24
    ? `${hours}h ${pad(minutes % 60)}m`
    : `${Math.floor(hours / 24)}d ${pad(hours % 24)}h`
}

/** `label` then `parts` joined by ` · `, wrapped under the label so no line passes 80 columns. */
function row(label: string, parts: readonly string[]): string[] {
  const lines: string[] = []
  let line = ''
  for (const part of parts) {
    const next = line === '' ? part : `${line} · ${part}`
    if (line !== '' && LABEL + next.length > WIDTH) {
      lines.push(line)
      line = part
    } else {
      line = next
    }
  }
  return [...lines, line].map((one, index) => `${(index === 0 ? label : '').padEnd(LABEL)}${one}`)
}

function windowOf(metrics: GameMetrics): string {
  const { since, until, ticket, character } = metrics.window
  const range = [since ? `since ${since}` : null, until ? `until ${until}` : null]
    .filter(Boolean)
    .join(' ')
  return [
    range || 'all recorded time',
    ticket ?? 'all tickets',
    ...(character ? [character] : [])
  ].join(' · ')
}

/** The stored character `--character` names, by its key or the name it was last shown under. */
async function characterOf(
  client: Parameters<CommandHandler>[0]['client'],
  flags: Map<string, string | boolean>
): Promise<GameCharacter | undefined> {
  if (!flags.has('character')) {
    return undefined
  }
  const wanted = optionalText(flags, 'character')
  if (wanted === undefined) {
    throw new RuntimeClientError('invalid_argument', '--character needs a name, like Merlin.')
  }
  const { result } = await callGameBoard<{ characters: GameCharacter[] }>(
    client,
    'game.characters',
    gameBoardCaller(),
    'characters'
  )
  if (result.characters.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      'No character has been recorded in this project yet: one is once the lead frees a member.'
    )
  }
  const lower = wanted.toLowerCase()
  const found = result.characters.find(
    (one) => one.key === lower || one.name.toLowerCase() === lower
  )
  if (!found) {
    const known = result.characters.map((one) => one.name).join(', ')
    throw new RuntimeClientError(
      'invalid_argument',
      `No character "${wanted}" in this project. Known: ${known}.`
    )
  }
  return found
}

function timezoneOf(flags: Map<string, string | boolean>): string {
  const zone = optionalText(flags, 'timezone')
  if (zone === undefined || zone === ORCHESTRATOR_GAME_LOCAL_TIMEZONE) {
    return desktopGameTimezoneOf(ORCHESTRATOR_GAME_LOCAL_TIMEZONE)
  }
  if (!isOrchestratorGameTimezone(zone)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--timezone must be a zone like America/Bogota or UTC, not "${zone}".`
    )
  }
  return zone
}

function dailyLines(daily: GameMetricsSummary): string[] {
  const merged = daily.mergedPerDay.reduce((sum, one) => sum + one.merged, 0)
  const median = daily.leadTime.medianMs
  return [
    ...row(`Last ${daily.mergedPerDay.length} days`, [
      `to ${daily.mergedPerDay.at(-1)?.day ?? '?'} ${daily.timezone}`,
      `${merged} merged`,
      `lead time median ${median === null ? 'no data' : formatDuration(median)}`
    ]),
    ...row(
      'Merged per day',
      daily.mergedPerDay.map((one) => `${one.day.slice(5)} ${one.merged}`)
    )
  ]
}

export function formatGameMetrics(metrics: GameMetrics & { daily?: GameMetricsSummary }): string {
  const { leadTime } = metrics
  const lines = [`Game metrics · ${windowOf(metrics)}`]
  if (metrics.daily) {
    lines.push(...dailyLines(metrics.daily))
  }
  if (metrics.character) {
    const { name, level, xp } = metrics.character
    lines.push(...row('Character', [name, `level ${level.level}`, `${xp} XP`]))
  }
  lines.push(...row('Tickets done', [String(metrics.ticketsDone.length), ...metrics.ticketsDone]))
  if (leadTime.medianMs === null || leadTime.meanMs === null) {
    lines.push(...row('Lead time', ['no data']))
  } else {
    lines.push(
      ...row('Lead time', [
        `median ${formatDuration(leadTime.medianMs)}`,
        `mean ${formatDuration(leadTime.meanMs)}`,
        `${leadTime.tickets.length} measured`
      ])
    )
    for (const one of leadTime.tickets) {
      const notes = [
        formatDuration(one.ms),
        ...(one.claims > 1 ? [`${one.claims} claims`] : []),
        ...(one.endsAt === 'member_freed' ? ['ends when freed'] : [])
      ]
      lines.push(`  ${one.ticket.padEnd(LABEL - 2)}${notes.join(' · ')}`)
    }
  }
  if (leadTime.unmeasured.length > 0) {
    lines.push(...row('  no claim', leadTime.unmeasured))
  }
  lines.push(
    ...row(
      'Freed members',
      Object.entries(metrics.outcomes).map(([outcome, count]) => `${outcome} ${count}`)
    )
  )
  const events = Object.entries(metrics.events).filter(([, count]) => count > 0)
  lines.push(
    ...row(
      'Events',
      events.length === 0 ? ['none'] : events.map(([kind, count]) => `${kind} ${count}`)
    )
  )
  const width = Math.max(...metrics.notRecorded.map((one) => one.label.length))
  lines.push('Not recorded yet:')
  for (const one of metrics.notRecorded) {
    lines.push(`  ${one.label.padEnd(width)}  not recorded · needs ${one.needs}`)
  }
  if (metrics.truncated.events) {
    lines.push(
      `Note: only the last ${GAME_EVENTS_MAX} events are kept; this window starts before them.`
    )
  }
  if (metrics.truncated.history) {
    lines.push(
      `Note: only the last ${GAME_HISTORY_MAX} freed members are kept; the window starts before.`
    )
  }
  const own = metrics.character
  if (own && own.tasksKept < own.tasksTotal) {
    lines.push(
      `Note: only ${own.name}'s last ${own.tasksKept} of ${own.tasksTotal} tasks are kept; older ones do not count.`
    )
  }
  return lines.join('\n')
}

export const ORCHESTRATOR_GAME_METRICS_HANDLERS: Record<string, CommandHandler> = {
  'game metrics': async ({ flags, client, json }) => {
    const ticket = optionalText(flags, 'ticket')
    const since = sinceOf(flags)
    const until = untilOf(flags)
    const timezone = timezoneOf(flags)
    const character = await characterOf(client, flags)
    // Why unfiltered: a claim before --since still starts the lead time of a merge inside it.
    const events = await callGameBoard<{ events: unknown[] }>(
      client,
      'game.events',
      gameBoardCaller(),
      'events'
    )
    const history = await callGameBoard<{ records: unknown[] }>(
      client,
      'game.history',
      gameBoardCaller(),
      'history'
    )
    const stores = {
      events: events.result.events.map(parseGameEvent).filter((one) => one !== null),
      history: history.result.records.map(parseGameHistoryRecord).filter((one) => one !== null)
    }
    const metrics = computeGameMetrics(stores, { ticket, since, until, character })
    // Why only unfiltered: the days are the scene widget's own window, not the query's.
    const filtered = [ticket, since, until, character].some((one) => one !== undefined)
    const daily = filtered ? null : gameMetricsSummaryOf(stores, { now: Date.now(), timezone })
    printResult(
      { ...history, result: daily ? { ...metrics, daily } : metrics },
      json,
      formatGameMetrics
    )
  }
}
