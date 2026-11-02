import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { GameState } from '../types'
import { cellWidthOf } from './cell-width'
import type { SectionMarks } from './fleet-project'
import { gameStrings } from './game-strings'
import {
  accountLinesOf,
  leadTimeOf,
  mergedAxisOf,
  mergedBarsOf,
  mergedStatsOf,
  type MetricsTone
} from './metrics-widget'
import { metricsWords } from './metrics-words'
import type { BandPalette } from './scenes/scene-definition'

// Below this the Merged and Lead time cards stack instead of sitting side by side.
const SIDE_BY_SIDE_COLUMNS = 72
const LEAD_CARD_MIN_CELLS = 26
// A card's round border and its one-cell padding on each side.
const CARD_CHROME_CELLS = 4

/** The Metrics widget: titled cards for the lead's merges per day, lead time and Claude accounts. */
export function metricsSectionOf(
  $: EngineInterface,
  e: RenderInput,
  state: GameState,
  palette: BandPalette,
  columns: number,
  marks: SectionMarks
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const words = metricsWords()
  const colorOf: Readonly<Record<MetricsTone, string | undefined>> = {
    gold: palette.gold,
    dim: undefined,
    track: palette.panel,
    plain: palette.parchment,
    warning: 'yellow',
    danger: 'red'
  }
  const card = (key: string, title: string, children: RenderElement[], width?: number) => (
    <Box
      key={key}
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.panel}
      paddingX={1}
      flexGrow={width === undefined ? 1 : 0}
      flexShrink={0}
      {...(width === undefined ? {} : { width })}
    >
      <Text color={palette.gold} bold>
        {title}
      </Text>
      {children}
    </Box>
  )
  const figure = (key: string, value: string, label: string) => (
    <Text key={key}>
      <Text color={palette.parchment} bold>
        {value}
      </Text>
      <Text dimColor>{` ${label}`}</Text>
    </Text>
  )
  const metrics = state.metrics
  const body = (): RenderElement[] => {
    if (metrics === undefined) {
      return [
        <Text key="metrics-missing" dimColor wrap="wrap">
          {words.missing}
        </Text>
      ]
    }
    const days = metrics.mergedPerDay
    const stats = mergedStatsOf(days)
    const statsText = `${words.merged(stats.total, days.length)}  ${stats.perDay} ${words.perDay}  ${stats.peak} ${words.peak}`
    const isSide = columns >= SIDE_BY_SIDE_COLUMNS
    const barRoom = isSide
      ? columns - LEAD_CARD_MIN_CELLS - 1 - CARD_CHROME_CELLS
      : columns - CARD_CHROME_CELLS
    const bars = mergedBarsOf(
      days.map((one) => one.merged),
      barRoom
    )
    const axis = mergedAxisOf(days, bars.width)
    const merged = card(
      'metrics-merged',
      words.mergedTitle,
      [
        ...bars.rows.map((row, at) => (
          <Text key={`metrics-bars-${at}`} color={palette.gold}>
            {row}
          </Text>
        )),
        ...(axis === ''
          ? []
          : [
              <Text key="metrics-axis" dimColor>
                {axis}
              </Text>
            ]),
        <Box key="metrics-stats" flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
          <Text color={palette.parchment}>{words.merged(stats.total, days.length)}</Text>
          {figure('metrics-per-day', stats.perDay, words.perDay)}
          {figure('metrics-peak', String(stats.peak), words.peak)}
        </Box>
      ],
      isSide
        ? Math.min(barRoom, Math.max(bars.width, cellWidthOf(statsText))) + CARD_CHROME_CELLS
        : undefined
    )
    const lead = leadTimeOf(metrics)
    const leadCard = card('metrics-lead', words.leadTitle, [
      lead.value === null ? (
        <Text key="metrics-lead-none" dimColor>
          {words.noneMeasured}
        </Text>
      ) : (
        <Text key="metrics-lead-value">
          <Text color={palette.gold} bold>
            {lead.value}
          </Text>
          <Text dimColor>{`  ${words.median}`}</Text>
        </Text>
      ),
      <Text key="metrics-lead-measured" dimColor>
        {words.measured(lead.measured)}
      </Text>
    ])
    const accounts = metrics.claudeAccounts
    return [
      isSide ? (
        <Box key="metrics-top" flexDirection="row" columnGap={1}>
          {merged}
          {leadCard}
        </Box>
      ) : (
        merged
      ),
      ...(isSide ? [] : [leadCard]),
      ...(accounts.length === 0
        ? []
        : [
            card(
              'metrics-accounts',
              words.accountsTitle,
              accountLinesOf(accounts, columns - CARD_CHROME_CELLS).map((line) => (
                <Box key={`metrics-${line.key}`} flexDirection="row">
                  {line.parts.map((part, at) => (
                    <Text
                      key={`metrics-${line.key}-${at}`}
                      color={colorOf[part.tone]}
                      dimColor={part.tone === 'dim'}
                      bold={part.tone === 'danger'}
                    >
                      {part.text}
                    </Text>
                  ))}
                </Box>
              ))
            )
          ])
    ]
  }
  return (
    <Box key="section-metrics" flexDirection="column">
      {marks.headingOf('metrics', gameStrings().text.layoutSections.metrics)}
      {!marks.isCollapsed('metrics') && body()}
    </Box>
  )
}
