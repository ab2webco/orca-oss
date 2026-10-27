import type { EngineInterface } from 'claude-code'

import { flatToggleLabelsOf, petLabelOf } from './band-chips'
import { refreshSoon } from './fleet-sync'
import { toggleFlat } from './flat-toggle'
import { gameStrings } from './game-strings'
import { CATALOG_MENU_KEY, catalogMenuLabelsOf, toggleCatalog } from './panel-widgets'
import { clawdReact } from './quest-runtime'
import type { SceneDefinition } from './scenes/index'
import { toggleViewPicker, viewMenuLabelsOf, VIEW_MENU_KEY } from './view-picker'

export type PaneMenuItem = {
  key: string
  hotkey?: string
  /** The full label first, then a shorter one a phone chip may take. */
  labels: readonly [string, ...string[]]
  onPress: () => void
}

/** The Panel's menu: Refresh, the flat toggle, the view selector, Pet while the scene draws, and Close last. */
export function paneMenuItemsOf(
  $: EngineInterface,
  scene: SceneDefinition,
  isFlat: boolean,
  close: () => void
): PaneMenuItem[] {
  const text = gameStrings().text
  const pet = {
    key: 'pet',
    hotkey: 'p',
    labels: [petLabelOf(scene), '♥'] as const,
    onPress: () => clawdReact($, 'pet')
  }
  return [
    {
      key: 'refresh',
      hotkey: 'r',
      labels: [`↻ ${text.refresh}`, '↻'],
      onPress: () => void refreshSoon($).catch(() => undefined)
    },
    // Why 0: digits 1-9 view members and every letter is taken by the menu, links and actions.
    {
      key: 'flat',
      hotkey: '0',
      labels: flatToggleLabelsOf(isFlat),
      onPress: () => void toggleFlat($).catch(() => undefined)
    },
    // Why no hotkey: every letter and digit is taken; the selector is a press away.
    { key: VIEW_MENU_KEY, labels: viewMenuLabelsOf(), onPress: () => toggleViewPicker($) },
    // Why no hotkey: every letter and digit is taken; the catalog is a press away.
    { key: CATALOG_MENU_KEY, labels: catalogMenuLabelsOf(), onPress: () => toggleCatalog($) },
    ...(isFlat ? [] : [pet]),
    { key: 'quit', hotkey: 'q', labels: [`✕ ${text.close}`], onPress: close }
  ]
}
