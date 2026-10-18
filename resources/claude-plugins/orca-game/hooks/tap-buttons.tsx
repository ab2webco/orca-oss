import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { HOTKEY_CELLS, tapLabelOf } from './tap-layout'

export type TapButton = {
  key: string
  label: string
  hotkey?: string
  onPress: () => void
  color: string
  backgroundColor: string
  bold?: boolean
}

// A Button holds only Text, so its two rows are one padded two-line Text; the gap is the blank row.
/** Full-width, two-row buttons with a blank row above the group and between each two. */
export function tapButtonsOf(
  $: EngineInterface,
  e: RenderInput,
  key: string,
  buttons: readonly TapButton[],
  columns: number
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box key={key} flexDirection="column" rowGap={1} marginTop={1}>
      {buttons.map((one) => (
        <Button key={one.key} plain hotkey={one.hotkey} onPress={one.onPress}>
          <Text backgroundColor={one.backgroundColor} color={one.color} bold={one.bold}>
            {tapLabelOf(one.label, columns, one.hotkey === undefined ? 0 : HOTKEY_CELLS)}
          </Text>
        </Button>
      ))}
    </Box>
  )
}
