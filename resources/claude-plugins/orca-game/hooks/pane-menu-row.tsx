import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { PaneMenuItem } from './pane-menu'
import type { BandPalette } from './scenes/scene-definition'
import { tapButtonsOf } from './tap-buttons'
import { closeChipCellsOf, HOTKEY_CELLS, isTapLayout, tapChipOf } from './tap-layout'

/** The Panel's menu: one row of buttons when wide; on a phone, Close on its own row, then the chips. */
export function paneMenuRowOf(
  $: EngineInterface,
  e: RenderInput,
  palette: BandPalette,
  columns: number,
  items: readonly PaneMenuItem[],
  picker: RenderElement
): RenderElement {
  const { Box, Button, Text } = $.ui.resolve(e)
  const chipColors = { color: palette.parchment, backgroundColor: palette.panel }
  if (!isTapLayout(columns)) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {items.map((one) => (
            <Button key={one.key} plain hotkey={one.hotkey} onPress={one.onPress}>
              <Text {...chipColors} bold>{` ${one.labels[0]} `}</Text>
            </Button>
          ))}
        </Box>
        {picker}
      </Box>
    )
  }
  // Close is last in the menu; a phone shows the pane's top rows, and Close is how it leaves.
  const close = items.at(-1)
  return (
    <Box flexDirection="column">
      {close !== undefined && (
        // Under the pane's ✕, half the pane wide for a thumb, a blank row apart from Refresh.
        <Box key="pane-close-row" flexDirection="row" justifyContent="flex-end" marginTop={1}>
          <Button key={close.key} plain hotkey={close.hotkey} onPress={close.onPress}>
            <Text {...chipColors} bold>
              {tapChipOf(
                close.labels[0],
                closeChipCellsOf(columns, close.labels[0]),
                close.hotkey === undefined ? 0 : HOTKEY_CELLS
              )}
            </Text>
          </Button>
        </Box>
      )}
      {tapButtonsOf(
        $,
        e,
        'pane-menu-tap',
        items.slice(0, -1).map((one) => ({ ...one, ...chipColors, bold: true })),
        columns
      )}
      {picker}
    </Box>
  )
}
