import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { GameState } from '../types'
import type { SectionMarks } from './fleet-project'
import { gameStrings } from './game-strings'
import { metricsLinesOf, type MetricsTone } from './metrics-widget'
import { metricsWords } from './metrics-words'
import type { BandPalette } from './scenes/scene-definition'

/** The Metrics widget: the lead's merges per day, lead time and Claude accounts, drawn from the state. */
export function metricsSectionOf(
  $: EngineInterface,
  e: RenderInput,
  state: GameState,
  palette: BandPalette,
  columns: number,
  marks: SectionMarks
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const colorOf: Readonly<Record<MetricsTone, string | undefined>> = {
    gold: palette.gold,
    dim: undefined,
    plain: undefined,
    warning: 'yellow',
    danger: 'red'
  }
  const rows =
    state.metrics === undefined ? (
      <Text key="metrics-missing" dimColor wrap="wrap">
        {metricsWords().missing}
      </Text>
    ) : (
      metricsLinesOf(state.metrics, columns).map((line) => (
        <Box key={`metrics-${line.key}`} flexDirection="row" flexWrap="wrap">
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
  return (
    <Box key="section-metrics" flexDirection="column">
      <Box key="layout-header-metrics" flexDirection="row">
        {marks.markOf('metrics')}
        <Text bold>{gameStrings().text.layoutSections.metrics}</Text>
      </Box>
      {!marks.isCollapsed('metrics') && rows}
    </Box>
  )
}
