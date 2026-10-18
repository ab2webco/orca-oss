import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { MORE_CHIP_KEY } from './chip-rows'
import { HOTKEY_CELLS, tapChipOf, tapRowsOf } from './tap-layout'

export type TapButton = {
  key: string
  /** The full label first, then shorter ones tried before a chip is dropped. */
  labels: readonly [string, ...string[]]
  hotkey?: string
  onPress: () => void
  color: string
  backgroundColor: string
  bold?: boolean
}

/** Past `maxRows` the dropped chips are counted on a `+N` chip keyed `key`. */
export type TapMore = Omit<TapButton, 'labels' | 'hotkey'> & { labelOf: (count: number) => string }

// A Button holds only Text, so a chip's three rows are one padded three-line Text.
/** Compact three-row chips in rows, a blank row above the group and between two rows. */
export function tapButtonsOf(
  $: EngineInterface,
  e: RenderInput,
  key: string,
  buttons: readonly TapButton[],
  columns: number,
  options: { maxRows?: number; more?: TapMore } = {}
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { maxRows, more } = options
  const byKey = new Map(buttons.map((one) => [one.key, one]))
  const rows = tapRowsOf(
    buttons.map((one, at) => ({ key: one.key, priority: at, labels: one.labels })),
    {
      columns,
      ...(maxRows === undefined ? {} : { maxRows }),
      ...(more === undefined ? {} : { more: more.labelOf })
    }
  )
  return (
    <Box key={key} flexDirection="column" rowGap={1} marginTop={1}>
      {rows.map((row) => (
        <Box key={`${key}-${row[0]?.key ?? 'empty'}`} flexDirection="row" columnGap={1}>
          {row.map((chip) => {
            const one = chip.key === MORE_CHIP_KEY ? more : byKey.get(chip.key)
            if (one === undefined) {
              return null
            }
            const hotkey = 'hotkey' in one ? one.hotkey : undefined
            return (
              <Button key={one.key} plain hotkey={hotkey} onPress={one.onPress}>
                <Text backgroundColor={one.backgroundColor} color={one.color} bold={one.bold}>
                  {tapChipOf(chip.label, chip.width, hotkey === undefined ? 0 : HOTKEY_CELLS)}
                </Text>
              </Button>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
