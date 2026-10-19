import type { TextProps } from 'claude-code'

import type { AllyStatus } from '../types'
import { cellWidthOf, fitCells } from './cell-width'
import type { BandPalette } from './scenes/scene-definition'

// Jev's `advisor` value (orca-jev-mod-skills, AdvisorState version 1), only the fields the strip draws.
export type AdvisorAgent = {
  id: string
  title: string
  model: string | null
  /** Absent from an item this build cannot read; null when Jev set none. */
  effort: string | number | null
  /** Why Jev picked the model (`lowered`, `kept-unsure`…); one this build does not know stays as text. */
  why: string | null
  verdict: string
}
export type AdvisorCi = {
  id: string
  status: 'watching' | 'success' | 'failure'
  text: string
}
export type AdvisorNotice = {
  id: string
  level: 'info' | 'warn' | 'block'
  text: string
}
export type Advisor = {
  line: string | null
  model: string | null
  effort: string | number | null
  subagents: readonly AdvisorAgent[]
  ci: readonly AdvisorCi[]
  notices: readonly AdvisorNotice[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string'

const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value)

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    isText(value) && (values as readonly string[]).includes(value)

const isCiStatus = oneOf(['watching', 'success', 'failure'] as const)
const isLevel = oneOf(['info', 'warn', 'block'] as const)

const listOf = <T>(
  value: unknown,
  read: (item: Record<string, unknown>) => T | null
): T[] | null => {
  if (!Array.isArray(value)) {
    return null
  }
  // Why per item: one row Jev adds later must not take its whole line and band away.
  return value.flatMap((item) => {
    const parsed = isRecord(item) ? read(item) : null
    return parsed === null ? [] : [parsed]
  })
}

const isEffort = (value: unknown): value is string | number | null =>
  value === null || isText(value) || typeof value === 'number'

const agentOf = (raw: Record<string, unknown>): AdvisorAgent | null =>
  isText(raw.id) && isText(raw.title) && isTextOrNull(raw.model) && isText(raw.verdict)
    ? {
        id: raw.id,
        title: raw.title,
        model: raw.model,
        effort: isEffort(raw.effort) ? raw.effort : null,
        why: isText(raw.why) ? raw.why : null,
        verdict: raw.verdict
      }
    : null

const ciOf = (raw: Record<string, unknown>): AdvisorCi | null =>
  isText(raw.id) && isCiStatus(raw.status) && isText(raw.text)
    ? { id: raw.id, status: raw.status, text: raw.text }
    : null

const noticeOf = (raw: Record<string, unknown>): AdvisorNotice | null =>
  isText(raw.id) && isLevel(raw.level) && isText(raw.text)
    ? { id: raw.id, level: raw.level, text: raw.text }
    : null

// Read without depending on Jev: any version or shape this build does not know is no Jev at all.
export const advisorOf = (value: unknown): Advisor | null => {
  if (!isRecord(value) || value.version !== 1) {
    return null
  }
  const { line, model, effort } = value
  if (!isTextOrNull(line) || !isTextOrNull(model) || !isEffort(effort)) {
    return null
  }
  const subagents = listOf(value.subagents, agentOf)
  const ci = listOf(value.ci, ciOf)
  const notices = listOf(value.notices, noticeOf)
  if (subagents === null || ci === null || notices === null) {
    return null
  }
  return { line, model, effort, subagents, ci, notices }
}

const oneLine = (text: string): string => (text.trim().split('\n')[0] ?? '').trim()

/** One line per plugin, the latest last; `undefined` or a blank line takes the plugin's away. */
export const withStatus = (
  statuses: readonly AllyStatus[],
  plugin: string,
  text: string | undefined
): AllyStatus[] => {
  const others = statuses.filter((one) => one.plugin !== plugin)
  const line = text === undefined ? '' : oneLine(text)
  return line === '' ? others : [...others, { plugin, text: line }]
}

export type AllyTone =
  | 'line'
  | 'agent'
  | 'ci-watching'
  | 'ci-success'
  | 'ci-failure'
  | 'info'
  | 'warn'
  | 'block'
  | 'status'
  | 'more'

export type AllyRow = {
  key: string
  tone: AllyTone
  text: string
  label?: string
  badge?: string
}

export type AllyLayout = {
  isZen: boolean
  maxRows: number
  more: (count: number) => string
}

const NOTICE_MARK: Readonly<Record<AdvisorNotice['level'], string>> = {
  info: '·',
  warn: '!',
  block: '✖'
}

/** A CI run's words, as the strip and the Panel's card both draw them. */
export const ciLineOf = (run: AdvisorCi): string => oneLine(run.text)

/** The latest notice's words behind its mark, as the strip and the Panel's card both draw them. */
export const noticeLineOf = (notice: AdvisorNotice): string =>
  `${NOTICE_MARK[notice.level]} ${oneLine(notice.text)}`

const jevRowsOf = (advisor: Advisor): AllyRow[] => {
  const badge = [advisor.model, advisor.effort].filter((one) => one !== null).join('·')
  const head: AllyRow[] =
    advisor.line === null && badge === ''
      ? []
      : [
          {
            key: 'ally-jev',
            tone: 'line',
            text: oneLine(advisor.line ?? ''),
            ...(badge === '' ? {} : { badge })
          }
        ]
  const agents = advisor.subagents.map((agent): AllyRow => {
    const parts = [agent.title, agent.model, agent.verdict]
      .map((one) => (one === null ? '' : oneLine(one)))
      .filter((one) => one !== '')
    return {
      key: `ally-jev-agent-${agent.id}`,
      tone: 'agent',
      text: `↳ ${parts.join(' · ')}`
    }
  })
  const ci = advisor.ci.map(
    (run): AllyRow => ({
      key: `ally-jev-ci-${run.id}`,
      tone: `ci-${run.status}`,
      text: ciLineOf(run)
    })
  )
  const notice = advisor.notices.at(-1)
  const notices: AllyRow[] =
    notice === undefined
      ? []
      : [
          {
            key: 'ally-jev-notice',
            tone: notice.level,
            text: noticeLineOf(notice)
          }
        ]
  return [...head, ...agents, ...ci, ...notices]
}

const statusRowOf = (status: AllyStatus): AllyRow => ({
  key: `ally-status-${status.plugin}`,
  tone: 'status',
  label: status.plugin,
  text: status.text
})

/** What the strip draws, top to bottom; zen keeps one line, Jev's before the latest status. */
export const allyRowsOf = (
  advisor: Advisor | null,
  statuses: readonly AllyStatus[],
  layout: AllyLayout
): AllyRow[] => {
  if (layout.isZen) {
    const latest = statuses.at(-1)
    if (advisor !== null && advisor.line !== null && oneLine(advisor.line) !== '') {
      return [{ key: 'ally-jev', tone: 'line', text: oneLine(advisor.line) }]
    }
    return latest === undefined ? [] : [statusRowOf(latest)]
  }
  const rows = [...(advisor === null ? [] : jevRowsOf(advisor)), ...statuses.map(statusRowOf)]
  if (rows.length <= layout.maxRows) {
    return rows
  }
  const kept = rows.slice(0, Math.max(0, layout.maxRows - 1))
  const more: AllyRow = {
    key: 'ally-more',
    tone: 'more',
    text: layout.more(rows.length - kept.length)
  }
  return [...kept, more]
}

export type AllyParts = { label?: string; text: string; badge?: string }

// A label takes at most a third of the row; a badge goes before the text is cut below this.
const MIN_TEXT = 12

/** A row's words cut to `columns` cells, padding included: label, then text, then badge. */
export const allyPartsOf = (row: AllyRow, columns: number): AllyParts => {
  const label =
    row.label === undefined ? undefined : fitCells(row.label, Math.floor(columns / 3) - 2)
  const labelWidth = label === undefined || label === '' ? 0 : cellWidthOf(label) + 2
  const badgeWidth = row.badge === undefined ? 0 : cellWidthOf(row.badge) + 2
  const textWidth = cellWidthOf(row.text) + 1
  const isTight =
    labelWidth + textWidth + badgeWidth > columns && columns - labelWidth - badgeWidth < MIN_TEXT
  const badge = isTight ? undefined : row.badge
  const room = columns - labelWidth - (badge === undefined ? 0 : badgeWidth) - 1
  return {
    ...(label === undefined || label === '' ? {} : { label }),
    text: fitCells(row.text, room),
    ...(badge === undefined ? {} : { badge })
  }
}

// Colors that carry a state stay, so another plugin's error still reads as one.
const STATE_COLORS: ReadonlySet<string> = new Set([
  'red',
  'green',
  'yellow',
  'error',
  'warning',
  'success'
])

/** Another plugin's words, in the scene palette: a highlighted run as the gold pill, the rest on the panel. */
export const restyledTextOf = <P extends TextProps>(props: P, palette: BandPalette): P => {
  if (props.backgroundColor !== undefined) {
    return { ...props, color: palette.ink, backgroundColor: palette.gold }
  }
  const color =
    props.color !== undefined && STATE_COLORS.has(props.color) ? props.color : palette.parchment
  return { ...props, color, backgroundColor: palette.panel }
}
