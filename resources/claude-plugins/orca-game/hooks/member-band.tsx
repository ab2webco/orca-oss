import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { BandPalette, GameState } from '../types'
import { fitCells } from './cell-width'
import { flatLine } from './flat-block'
import { memberSelfLineOf } from './flat-view'
import { gameStrings } from './game-strings'
import { holdQuestion, pendingQuestion } from './member-pane'
import { currentScene } from './quest-runtime'
import { shownPhase } from './quest-state'

export type MemberBandInput = {
  state: GameState | null
  palette: BandPalette
  columns: number
}

/** A member's band: its own line, then its question while the lead has not answered it. */
export function memberBandRows(
  $: EngineInterface,
  e: RenderInput,
  { state, palette, columns }: MemberBandInput
): RenderElement[] {
  const { Box, Text } = $.ui.resolve(e)
  const line = memberSelfLineOf(state, currentScene(), shownPhase(), columns)
  const self = flatLine($, e, line, palette)
  const question = pendingQuestion()
  if (question === undefined) {
    return [self]
  }
  const lead = state?.lead?.label ?? gameStrings().text.lead
  const asks = gameStrings().text.asksLead(lead)
  return [
    self,
    <Box key="band-member-question" flexDirection="row" overflow="hidden">
      <Text color="yellow" backgroundColor={palette.panel} bold wrap="truncate-end">
        {fitCells(`${asks} ${question}`, columns)}
      </Text>
    </Box>
  ]
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
