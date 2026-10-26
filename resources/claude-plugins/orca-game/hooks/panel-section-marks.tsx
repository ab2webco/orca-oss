import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { gameStrings } from './game-strings'
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

/** The ▾/▸ mark before each section heading; pressing it folds the section. */
export function sectionMarksOf(
  $: EngineInterface,
  e: RenderInput,
  project: string,
  layout: FleetLayout
): SectionMarks {
  const { Button, Text } = $.ui.resolve(e)
  const isCollapsed = (section: PanelSection) => layout.collapsed.includes(section)
  return {
    isCollapsed,
    // Why a separate mark: the To Do and My PRs headings already open their list or run an action.
    markOf: (section) => (
      <Button key={`layout-toggle-${section}`} plain onPress={togglePressOf($, project, section)}>
        <Text dimColor>{`${isCollapsed(section) ? '▸' : '▾'} `}</Text>
      </Button>
    )
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
