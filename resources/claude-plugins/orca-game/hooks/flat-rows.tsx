import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { BandPalette, GameAgent, GameState, RecentReward } from '../types'
import type { Level } from './fleet-hud'
import { flatLine } from './flat-block'
import { cellWidthOf } from './cell-width'
import { flatMemberLinesOf, flatNameOf, flatScoreLineOf } from './flat-view'
import { teamOrderOf } from './party'
import { currentScene } from './quest-runtime'
import { tapButtonsOf } from './tap-buttons'

// The band's team lines, the +N included; the Panel lists everyone.
const BAND_MEMBER_LINES = 6

export type FlatBandInput = {
  state: GameState
  palette: BandPalette
  columns: number
  level: Level | undefined
  recent: readonly RecentReward[] | undefined
  isDemo: boolean
}

/** The band's flat rows in place of the HUD: the score line, then one line per teammate. */
export function flatBandRows(
  $: EngineInterface,
  e: RenderInput,
  { state, palette, columns, level, recent, isDemo }: FlatBandInput
): RenderElement {
  const { Box } = $.ui.resolve(e)
  const score = flatScoreLineOf({ level, recent: recent ?? [], isDemo, columns })
  const members = flatMemberLinesOf({
    state,
    scene: currentScene(),
    columns,
    maxMembers: BAND_MEMBER_LINES
  })
  return (
    <Box key="band-flat-rows" flexDirection="column">
      {[...(score === undefined ? [] : [score]), ...members].map((line) =>
        flatLine($, e, line, palette)
      )}
    </Box>
  )
}

// Past this many the Panel's team ends in a +N line too.
const PANE_MEMBER_LINES = 40

export type FlatPaneInput = Pick<FlatBandInput, 'state' | 'palette' | 'columns'> & {
  isTap: boolean
  viewLabelOf: (agent: GameAgent) => string
  pressOf: (agent: GameAgent, handle: string) => () => void
  hotkeyOf: (index: number) => string | undefined
}

/** The Panel's team in flat: one line per member with its View, or on a phone one row of View chips. */
export function flatPaneMembers(
  $: EngineInterface,
  e: RenderInput,
  { state, palette, columns, isTap, viewLabelOf, pressOf, hotkeyOf }: FlatPaneInput
): RenderElement[] {
  const { Button, Text } = $.ui.resolve(e)
  // Why the widest: every line leaves the same room, so View, Resume and Reconnect line up.
  const viewCells =
    Math.max(...teamOrderOf(state).map((agent) => cellWidthOf(` ${viewLabelOf(agent)} `)), 0) + 1
  const lines = flatMemberLinesOf({
    state,
    scene: currentScene(),
    columns: isTap ? columns : Math.max(1, columns - viewCells),
    maxMembers: PANE_MEMBER_LINES
  })
  const viewable = teamOrderOf(state).flatMap((agent, index) =>
    agent.terminalHandle === undefined ? [] : [{ agent, handle: agent.terminalHandle, index }]
  )
  const byKey = new Map(viewable.map((one) => [one.agent.paneKey, one]))
  const rows = lines.map((line) => {
    const one = line.paneKey === undefined || isTap ? undefined : byKey.get(line.paneKey)
    const view =
      one === undefined ? undefined : (
        <Button
          key={`view-${one.agent.paneKey}`}
          plain
          hotkey={hotkeyOf(one.index)}
          onPress={pressOf(one.agent, one.handle)}
        >
          <Text backgroundColor={palette.panel} color={palette.parchment} bold>
            {` ${viewLabelOf(one.agent)} `}
          </Text>
        </Button>
      )
    return flatLine($, e, line, palette, view)
  })
  if (!isTap || viewable.length === 0) {
    return rows
  }
  // Why one row: a three-row chip under every line would read as the next member's and triple the rows.
  const taps = viewable.map(({ agent, handle, index }) => ({
    key: `view-${agent.paneKey}`,
    labels: [`▸ ${flatNameOf(agent)}`] as const,
    hotkey: hotkeyOf(index),
    onPress: pressOf(agent, handle),
    color: palette.parchment,
    backgroundColor: palette.panel,
    bold: true
  }))
  return [...rows, tapButtonsOf($, e, 'flat-views-tap', taps, columns)]
}
