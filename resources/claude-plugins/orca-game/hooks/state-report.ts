import type { GameAgent, GameMode, GameRender, GameSource, GameState } from '../types'
import { gameStateOf } from './game-state'
import { isShape, str, type Shape } from './game-state-shapes'
import type { MemberPhase, StateReportWords } from './state-report-words'

/** This pane's own mode and render, which `orca game state` cannot know. */
export type SessionOverrides = { mode?: GameMode | 'demo'; render?: GameRender }

// Mirrors Orca's src/shared/orchestrator-game-fleet-verbs.ts, which the mod cannot import.
const TICKET = /(?:^|[^A-Z0-9])([A-Z][A-Z0-9_]*-\d+)(?![A-Z0-9])/

export const ticketOf = (agent: GameAgent): string => {
  if (agent.workItem) {
    return agent.workItem.identifier.toUpperCase()
  }
  for (const text of [agent.displayName, agent.worktree?.displayName, agent.worktree?.branch]) {
    const ticket = text?.toUpperCase().match(TICKET)?.[1]
    if (ticket) {
      return ticket
    }
  }
  return agent.displayName
}

const isFinished = (agent: GameAgent): boolean => {
  const group = agent.workItem?.statusGroup
  return (
    agent.review?.state === 'merged' &&
    (group === undefined || group === 'review' || group === 'done')
  )
}

export const memberPhaseOf = (agent: GameAgent): MemberPhase => {
  if (isFinished(agent)) {
    return 'finished'
  }
  if (agent.limit?.loggedOut) {
    return 'needs-you'
  }
  if (agent.limit) {
    return 'limited'
  }
  if (agent.state === 'waiting') {
    return 'needs-you'
  }
  return agent.state === 'working' ? 'working' : 'idle'
}

const bodyOf = (stdout: string): Shape | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!isShape(parsed)) {
    return undefined
  }
  const body = 'result' in parsed ? parsed.result : parsed
  return isShape(body) ? body : undefined
}

const columnsOf = (rows: readonly (readonly string[])[]): string[] => {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((row) => row[i]?.length ?? 0)) + 2)
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths?.[i] ?? 0)))
      .join('')
      .trimEnd()
  )
}

function memberRowsOf(members: readonly GameAgent[], words: StateReportWords): string[] {
  const rows = members.map((agent) => {
    const review = agent.review
    const detail = [
      review
        ? `${review.provider === 'gitlab' ? 'MR' : 'PR'} #${review.number} ${words.reviewStates[review.state]}, CI ${words.ciWords[review.ci]}`
        : '',
      agent.workItem?.status ?? ''
    ].filter((one) => one !== '')
    return [ticketOf(agent), words.phases[memberPhaseOf(agent)], detail.join(' · ')]
  })
  return columnsOf(rows).map((row) => `  ${row}`)
}

function leadLinesOf(state: GameState, words: StateReportWords): string[] {
  const members = state.agents.filter((agent) => agent.isMember === true)
  if (state.lead === undefined && state.role === undefined && members.length === 0) {
    return []
  }
  const label = state.lead?.label
  if (state.role === 'member') {
    return [words.memberHere(label)]
  }
  const used = members.filter((agent) => !isFinished(agent)).length
  const head = [
    state.role === 'lead' ? words.leadsHere(label) : (label ?? ''),
    state.lead ? words.slots(used, state.lead.cap) : '',
    members.length === 0 ? words.noMembers : ''
  ].filter((one) => one !== '')
  return [head.join(' · '), ...memberRowsOf(members, words)]
}

function stopOf(raw: unknown, words: StateReportWords): string[] {
  if (!isShape(raw)) {
    return []
  }
  return [
    raw.unreadable === true
      ? words.stopUnreadable
      : words.stop(str(raw.since) ?? null, str(raw.by) ?? null)
  ]
}

/** `/orca-game:state`'s report from `orca game state --json`; undefined when it is no state. */
export const stateReportOf = (
  stdout: string,
  session: SessionOverrides,
  words: StateReportWords
): string | undefined => {
  const body = bodyOf(stdout)
  const state = body === undefined ? undefined : gameStateOf(body)
  if (body === undefined || state === undefined) {
    return undefined
  }
  const { config } = state
  const sources = state.sources ?? {}
  const sourced = (value: string, source: GameSource | undefined): string =>
    source === undefined ? value : `${value} ${words.from(source)}`
  // Why demo apart: /orca-game:demo sets it, not /orca-game:mode.
  const overridden = (value: string, session: string | undefined, key: 'mode' | 'render') =>
    session === undefined || session === value
      ? ''
      : ` · ${words.thisSession(session, `orca-game:${session === 'demo' ? 'demo' : key}`)}`
  const settings: [string, string][] = []
  if (config.mode !== undefined) {
    settings.push([
      words.mode,
      sourced(config.mode, sources.mode) + overridden(config.mode, session.mode, 'mode')
    ])
  }
  if (config.scene !== undefined) {
    const file = config.scene.startsWith('file:')
      ? ` · ${words.sceneFile(config.scene.slice(5))}`
      : ''
    settings.push([words.scene, sourced(config.scene, sources.scene) + file])
  }
  if (config.render !== undefined) {
    settings.push([
      words.render,
      sourced(config.render, sources.render) + overridden(config.render, session.render, 'render')
    ])
  }
  if (config.timezone !== undefined) {
    settings.push([words.timezone, sourced(config.timezone, sources.timezone)])
  }
  const tracker = isShape(body.config) ? body.config.tracker : undefined
  const flags = [
    config.hud === undefined ? '' : sourced(words.hud(config.hud), sources.hud),
    config.rewards === undefined ? '' : sourced(words.rewards(config.rewards), sources.rewards),
    typeof tracker === 'boolean' ? sourced(words.tracker(tracker), sources.tracker) : ''
  ].filter((one) => one !== '')
  const [lead = '', ...members] = leadLinesOf(state, words)
  const labels = [words.mode, words.scene, words.render, words.timezone, words.lead]
  const width = Math.max(...labels.map((one) => one.length)) + 2
  const where = state.worktree
    ? ` · ${state.worktree.displayName}${state.worktree.branch ? ` (${state.worktree.branch})` : ''}`
    : ''
  const links = columnsOf(state.links.map((link) => [link.label, link.url]))
  return [
    `${words.title}${where}`,
    ...settings.map(([label, value]) => `${label.padEnd(width)}${value}`),
    ...(flags.length > 0 ? [flags.join(' · ')] : []),
    ...(lead === '' ? [] : [`${words.lead.padEnd(width)}${lead}`, ...members]),
    ...stopOf(body.stopped, words),
    // Why not `-`: Claude Code draws a command's output as Markdown, where a list swallows the next lines.
    ...(state.warnings.length > 0
      ? [words.warnings, ...state.warnings.map((one) => `  • ${one}`)]
      : []),
    ...(links.length > 0 ? [words.links, ...links.map((one) => `  ${one}`)] : [])
  ].join('\n')
}
