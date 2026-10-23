import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { BandPalette } from '../types'
import type { FlatLine } from './flat-view'

type LineInk = { background?: string; text?: string }

function drawnLine(
  $: EngineInterface,
  e: RenderInput,
  line: FlatLine,
  ink: LineInk,
  trailing?: RenderElement
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key={line.key} flexDirection="row" overflow="hidden" columnGap={1}>
      <Text wrap="truncate-end" backgroundColor={ink.background}>
        {line.parts.map((part) => (
          <Text key={part.key} color={part.color ?? ink.text} bold={part.bold === true}>
            {part.text}
          </Text>
        ))}
      </Text>
      {trailing}
    </Box>
  )
}

/** One flat line on the band's panel color; a part with no color reads in parchment. */
export function flatLine(
  $: EngineInterface,
  e: RenderInput,
  line: FlatLine,
  palette: BandPalette,
  trailing?: RenderElement
): RenderElement {
  return drawnLine($, e, line, { background: palette.panel, text: palette.parchment }, trailing)
}

/** One flat line on the pane's own colors, so it reads in a light pane as in a dark one. */
export function paneLine($: EngineInterface, e: RenderInput, line: FlatLine): RenderElement {
  return drawnLine($, e, line, {})
}
