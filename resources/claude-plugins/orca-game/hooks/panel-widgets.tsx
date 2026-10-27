import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { gameStrings } from './game-strings'
import type { SceneDefinition } from './scenes/index'
import { tapButtonsOf } from './tap-buttons'
import { isTapLayout } from './tap-layout'
import {
  hideSection,
  moveSection,
  showSection,
  type FleetLayout,
  type PanelSection
} from './panel-layout'
import { changeFleetLayout } from './panel-layout-store'

// Module state: the catalog stays open across redraws, not across a reload.
let isOpen = false

export const CATALOG_MENU_KEY = 'widgets'

/** The Panel menu's chip for the catalog, full and short. */
export const catalogMenuLabelsOf = (): [string, string] => {
  const label = gameStrings().text.catalogMenu
  return [`▦ ${label}`, '▦']
}

export function toggleCatalog($: EngineInterface): void {
  isOpen = !isOpen
  $.ui.invalidate('ui.render')
}

type Chip = { key: string; label: string; isMarked: boolean; onPress: () => void }

/** Each section as a chip that adds or removes it; a shown one also gets its move chips. */
function chipsOf($: EngineInterface, project: string, layout: FleetLayout): Chip[] {
  const names = gameStrings().text.layoutSections
  const change = (edit: (now: FleetLayout) => FleetLayout) => () =>
    void changeFleetLayout($, project, edit).catch(() => undefined)
  return layout.order.flatMap((section: PanelSection): Chip[] => {
    const isShown = layout.shown.includes(section)
    const toggle: Chip = {
      key: `catalog-${section}`,
      label: `${isShown ? '●' : '○'} ${names[section]}`,
      isMarked: isShown,
      onPress: change((now) =>
        now.shown.includes(section) ? hideSection(now, section) : showSection(now, section)
      )
    }
    if (!isShown) {
      return [toggle]
    }
    return [
      toggle,
      {
        key: `catalog-up-${section}`,
        label: '↑',
        isMarked: false,
        onPress: change((now) => moveSection(now, section, 'up'))
      },
      {
        key: `catalog-down-${section}`,
        label: '↓',
        isMarked: false,
        onPress: change((now) => moveSection(now, section, 'down'))
      }
    ]
  })
}

/** The open catalog under the Panel menu: the sections, each added, removed or moved. */
export function catalogPickerOf(
  $: EngineInterface,
  e: RenderInput,
  palette: SceneDefinition['band'],
  columns: number,
  project: string,
  layout: FleetLayout
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  if (!isOpen) {
    return <Box key="panel-catalog" />
  }
  const chips = chipsOf($, project, layout)
  const colorsOf = (chip: Chip) => ({
    color: chip.isMarked ? palette.ink : palette.parchment,
    backgroundColor: chip.isMarked ? palette.gold : palette.panel
  })
  if (isTapLayout(columns)) {
    return (
      <Box key="panel-catalog" flexDirection="column">
        {tapButtonsOf(
          $,
          e,
          'panel-catalog-tap',
          chips.map((chip) => ({ ...chip, labels: [chip.label], ...colorsOf(chip), bold: true })),
          columns
        )}
      </Box>
    )
  }
  return (
    <Box key="panel-catalog" flexDirection="row" columnGap={1} flexWrap="wrap">
      <Text dimColor>{gameStrings().text.catalogMenu}</Text>
      {chips.map((chip) => (
        <Button key={chip.key} plain onPress={chip.onPress}>
          <Text {...colorsOf(chip)} bold>{` ${chip.label} `}</Text>
        </Button>
      ))}
    </Box>
  )
}
