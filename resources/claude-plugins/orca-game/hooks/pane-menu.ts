import type { EngineInterface } from 'claude-code'

import { flatToggleLabelsOf, petLabelOf } from './band-chips'
import { refreshSoon } from './fleet-sync'
import { toggleFlat } from './flat-toggle'
import { gameStrings } from './game-strings'
import { clawdReact } from './quest-runtime'
import type { SceneDefinition } from './scenes/index'

export type PaneMenuItem = { key: string; hotkey: string; label: string; onPress: () => void }

/** The Panel's menu: Refresh, the flat toggle, Pet while the scene draws, and Close last. */
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
    label: petLabelOf(scene),
    onPress: () => clawdReact($, 'pet')
  }
  return [
    {
      key: 'refresh',
      hotkey: 'r',
      label: `↻ ${text.refresh}`,
      onPress: () => void refreshSoon($).catch(() => undefined)
    },
    // Why 0: digits 1-9 view members and every letter is taken by the menu, links and actions.
    {
      key: 'flat',
      hotkey: '0',
      label: flatToggleLabelsOf(isFlat)[0],
      onPress: () => void toggleFlat($).catch(() => undefined)
    },
    ...(isFlat ? [] : [pet]),
    { key: 'quit', hotkey: 'q', label: `✕ ${text.close}`, onPress: close }
  ]
}
