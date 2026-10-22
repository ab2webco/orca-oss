import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { BandPalette } from '../types'
import type { FlatLine } from './flat-view'

/** One flat line on the band's panel color; a part with no color reads in parchment. */
export function flatLine(
  $: EngineInterface,
  e: RenderInput,
  line: FlatLine,
  palette: BandPalette,
  trailing?: RenderElement
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key={line.key} flexDirection="row" overflow="hidden" columnGap={1}>
      <Text wrap="truncate-end" backgroundColor={palette.panel}>
        {line.parts.map((part) => (
          <Text key={part.key} color={part.color ?? palette.parchment} bold={part.bold === true}>
            {part.text}
          </Text>
        ))}
      </Text>
      {trailing}
    </Box>
  )
}
