import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { cellWidthOf } from './cell-width'
import { gameStrings } from './game-strings'
import { headingPartsOf } from './panel-heading'
import type { SceneDefinition } from './scenes/index'
import { tapButtonsOf } from './tap-buttons'
import type { SectionMarks } from './fleet-project'
import { toggleSection, type FleetLayout, type PanelSection } from './panel-layout'
import { changeFleetLayout } from './panel-layout-store'

/** The press that folds or unfolds a section, kept for the project. */
function togglePressOf($: EngineInterface, project: string, section: PanelSection): () => void {
  return () =>
    void changeFleetLayout($, project, (now) => toggleSection(now, section)).catch(() => undefined)
}

const MARK_CELLS = 2

/** The ▾/▸ mark before each section heading, pressed to fold it, and the heading row every section shares. */
export function sectionMarksOf(
  $: EngineInterface,
  e: RenderInput,
  project: string,
  layout: FleetLayout,
  palette: SceneDefinition['band'],
  columns: number
): SectionMarks {
  const { Box, Button, Text } = $.ui.resolve(e)
  const isCollapsed = (section: PanelSection) => layout.collapsed.includes(section)
  // Why a separate mark: the To Do and My PRs headings already open their list or run an action.
  const markOf = (section: PanelSection) => (
    <Button key={`layout-toggle-${section}`} plain onPress={togglePressOf($, project, section)}>
      <Text dimColor>{`${isCollapsed(section) ? '▸' : '▾'} `}</Text>
    </Button>
  )
  return {
    isCollapsed,
    markOf,
    headingOf: (section, text, options = {}) => {
      const { name, count } = headingPartsOf(text)
      const title = name.toLocaleUpperCase()
      const chip = count === undefined ? '' : ` ${count} `
      const used = MARK_CELLS + cellWidthOf(title) + (chip === '' ? 0 : 1 + cellWidthOf(chip))
      const rule = '─'.repeat(Math.max(0, columns - used - 1))
      const titleText = (
        <Text
          bold
          underline={options.wrap !== undefined}
          color={options.isAlert ? 'red' : palette.gold}
        >
          {title}
        </Text>
      )
      return (
        <Box key={`layout-header-${section}`} flexDirection="row">
          {markOf(section)}
          {options.wrap === undefined ? titleText : options.wrap(titleText)}
          {chip !== '' && <Text> </Text>}
          {chip !== '' && (
            <Text bold color={palette.parchment} backgroundColor={palette.panel}>
              {chip}
            </Text>
          )}
          {options.suffix !== undefined && <Text> </Text>}
          {options.suffix ?? (rule !== '' && <Text color={palette.panel}>{` ${rule}`}</Text>)}
        </Box>
      )
    }
  }
}

/** On a phone, one touch chip per shown section: its ▾/▸ mark and name, pressed to fold it. */
export function sectionChipsOf(
  $: EngineInterface,
  e: RenderInput,
  palette: SceneDefinition['band'],
  columns: number,
  project: string,
  shown: readonly PanelSection[],
  isCollapsed: (section: PanelSection) => boolean
): RenderElement {
  const names = gameStrings().text.layoutSections
  return tapButtonsOf(
    $,
    e,
    'layout-tap',
    shown.map((section) => ({
      key: `layout-tap-${section}`,
      labels: [`${isCollapsed(section) ? '▸' : '▾'} ${names[section]}`],
      onPress: togglePressOf($, project, section),
      color: palette.parchment,
      backgroundColor: palette.panel
    })),
    columns
  )
}
