import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { BandPalette, GameState } from '../types'
import { flatToggleLabelsOf } from './band-chips'
import { fitCells } from './cell-width'
import { chipRowsOf, type Chip } from './chip-rows'
import { paneLine } from './flat-block'
import { dropScenes, isFlatMode, toggleFlat } from './flat-toggle'
import { memberSelfLineOf } from './flat-view'
import { refreshSoon } from './fleet-sync'
import { gameStrings } from './game-strings'
import { memberBandWords } from './member-band-words'
import {
  holdQuestion,
  isMemberBandCollapsed,
  pendingQuestion,
  setMemberBandCollapsed
} from './member-pane'
import { currentScene } from './quest-runtime'
import { shownPhase } from './quest-state'

export type MemberBandInput = {
  state: GameState | null
  palette: BandPalette
  columns: number
}

const COLLAPSE_KEY = 'band-member-collapse'
const FLAT_KEY = 'band-member-flat'
const REFRESH_KEY = 'band-member-refresh'

function toggleCollapsed($: EngineInterface): void {
  const isCollapsing = !isMemberBandCollapsed()
  setMemberBandCollapsed(isCollapsing)
  if (isCollapsing) {
    dropScenes()
  }
  $.ui.invalidate('ui.render')
}

/** Collapse, the text toggle and Refresh on the pane's colors; a member runs no team, so no Panel. */
function memberMenuRow($: EngineInterface, e: RenderInput, columns: number): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const text = gameStrings().text
  const words = memberBandWords()
  const chips: Chip[] = [
    {
      key: COLLAPSE_KEY,
      priority: 0,
      labels: isMemberBandCollapsed() ? [`▸ ${words.expand}`, '▸'] : [`▾ ${words.collapse}`, '▾']
    },
    { key: FLAT_KEY, priority: 1, labels: flatToggleLabelsOf(isFlatMode()) },
    { key: REFRESH_KEY, priority: 1, labels: [`↻ ${text.refresh}`, '↻'] }
  ]
  const presses: Readonly<Record<string, () => void>> = {
    [COLLAPSE_KEY]: () => toggleCollapsed($),
    [FLAT_KEY]: () => void toggleFlat($).catch(() => undefined),
    [REFRESH_KEY]: () => void refreshSoon($).catch(() => undefined)
  }
  const [row = []] = chipRowsOf(chips, { columns, maxRows: 1 })
  return (
    <Box key="band-member-menu" flexDirection="row" gap={1} overflow="hidden">
      {row.map((chip) => (
        <Button key={chip.key} plain onPress={presses[chip.key] ?? (() => undefined)}>
          <Text bold>{`[${chip.label}]`}</Text>
        </Button>
      ))}
    </Box>
  )
}

/** A member's band: its own line on the pane's colors, its question while the lead has not answered it, then its menu. */
export function memberBandRows(
  $: EngineInterface,
  e: RenderInput,
  { state, palette, columns }: MemberBandInput
): RenderElement[] {
  const { Box, Text } = $.ui.resolve(e)
  const question = pendingQuestion()
  const lead = state?.lead?.label ?? gameStrings().text.lead
  // Why kept when collapsed: the member is blocked until its lead answers.
  const asked =
    question === undefined
      ? []
      : [
          <Box key="band-member-question" flexDirection="row" overflow="hidden">
            <Text color="yellow" backgroundColor={palette.panel} bold wrap="truncate-end">
              {fitCells(`${gameStrings().text.asksLead(lead)} ${question}`, columns)}
            </Text>
          </Box>
        ]
  const menu = memberMenuRow($, e, columns)
  if (isMemberBandCollapsed()) {
    return [...asked, menu]
  }
  const line = memberSelfLineOf(state, currentScene(), shownPhase(), columns)
  return [paneLine($, e, line), ...asked, menu]
}

/** Shows the member's question on its band for as long as its `ask` waits on the lead. */
export async function whileAsking<T>(
  $: EngineInterface,
  question: string,
  ask: () => Promise<T>
): Promise<T> {
  holdQuestion(question)
  $.ui.invalidate('ui.render')
  try {
    return await ask()
  } finally {
    holdQuestion(undefined)
    $.ui.invalidate('ui.render')
  }
}
