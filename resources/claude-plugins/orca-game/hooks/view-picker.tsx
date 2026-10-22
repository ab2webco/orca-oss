import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { GAME_VIEWS, type GameViewId } from './game-view'
import type { SceneDefinition } from './scenes/index'
import { tapButtonsOf } from './tap-buttons'
import { isTapLayout } from './tap-layout'
import { viewWords, type ViewScope } from './view-words'
import { currentView, switchView, viewChoicesOf } from './view-switch'

// Module state: the selector stays open and keeps its scope across redraws, not across a reload.
let isOpen = false
let scope: ViewScope = 'pane'

export const VIEW_MENU_KEY = 'view'

/** The Panel menu's chip: the view shown now, full and short. */
export const viewMenuLabelsOf = (): [string, string] => {
  const name = viewWords().names[currentView()]
  return [`◐ ${viewWords().menu(name)}`, `◐ ${name}`]
}

export function toggleViewPicker($: EngineInterface): void {
  isOpen = !isOpen
  $.ui.invalidate('ui.render')
}

type Chip = { key: string; label: string; isMarked: boolean; onPress: () => void }

const chipLabelOf = (view: GameViewId, now: GameViewId, suggested: GameViewId | undefined) => {
  const words = viewWords()
  const cost = GAME_VIEWS.find((one) => one.id === view)?.cost ?? 'light'
  const mark = view === now ? '●' : '○'
  return `${mark} ${words.names[view]} · ${words.costs[cost]}${view === suggested ? ' ★' : ''}`
}

/** The open selector under the Panel menu: where the change goes, then every view. */
export async function viewPickerOf(
  $: EngineInterface,
  e: RenderInput,
  palette: SceneDefinition['band'],
  columns: number
): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e)
  if (!isOpen) {
    return <Box key="view-picker" />
  }
  const words = viewWords()
  const { scopes, suggested } = await viewChoicesOf($)
  if (!scopes.includes(scope)) {
    scope = 'pane'
  }
  const now = currentView()
  const scopeChips: Chip[] = scopes.map((one) => ({
    key: `view-scope-${one}`,
    label: `${one === scope ? '●' : '○'} ${words.scopes[one]}`,
    isMarked: one === scope,
    onPress: () => {
      scope = one
      $.ui.invalidate('ui.render')
    }
  }))
  const viewChips: Chip[] = GAME_VIEWS.map(({ id }) => ({
    key: `view-pick-${id}`,
    label: chipLabelOf(id, now, suggested),
    isMarked: id === now,
    onPress: () =>
      void switchView($, id, scope).then((said) => {
        isOpen = false
        $.ui.toast(said)
        $.ui.invalidate('ui.render')
      })
  }))
  const colorsOf = (chip: Chip) => ({
    color: chip.isMarked ? palette.ink : palette.parchment,
    backgroundColor: chip.isMarked ? palette.gold : palette.panel
  })
  const note = scopes.length === 1 ? <Text dimColor>{words.paneOnly}</Text> : null
  if (isTapLayout(columns)) {
    const tap = (key: string, chips: Chip[]) =>
      tapButtonsOf(
        $,
        e,
        key,
        chips.map((chip) => ({ ...chip, labels: [chip.label], ...colorsOf(chip), bold: true })),
        columns
      )
    return (
      <Box key="view-picker" flexDirection="column">
        {scopes.length > 1 ? tap('view-scopes', scopeChips) : note}
        {tap('view-picks', viewChips)}
      </Box>
    )
  }
  const row = (key: string, chips: Chip[], lead: readonly RenderElement[]) => (
    <Box key={key} flexDirection="row" columnGap={1} flexWrap="wrap">
      {lead}
      {chips.map((chip) => (
        <Button key={chip.key} plain onPress={chip.onPress}>
          <Text {...colorsOf(chip)} bold>{` ${chip.label} `}</Text>
        </Button>
      ))}
    </Box>
  )
  return (
    <Box key="view-picker" flexDirection="column">
      {scopes.length > 1
        ? row('view-scopes', scopeChips, [
            <Text key="where" dimColor>
              {words.where}
            </Text>
          ])
        : note}
      {row('view-picks', viewChips, [])}
    </Box>
  )
}
