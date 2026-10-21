import type { EngineInterface } from 'claude-code'

import { gameStrings } from './game-strings'
import { PANEL_LAYOUT_KEY, fleetLayoutOf, withFleetLayout, type FleetLayout } from './panel-layout'

export async function readFleetLayout($: EngineInterface, project: string): Promise<FleetLayout> {
  return fleetLayoutOf(await $.store.get(PANEL_LAYOUT_KEY).catch(() => undefined), project)
}

/**
 * Applies `change` to the stored layout and redraws; false, with a toast, when a newer build wrote it.
 * Read just before the write, so two windows of one project end on the last change.
 */
export async function changeFleetLayout(
  $: EngineInterface,
  project: string,
  change: (layout: FleetLayout) => FleetLayout
): Promise<boolean> {
  const stored = await $.store.get(PANEL_LAYOUT_KEY).catch(() => undefined)
  const next = withFleetLayout(stored, project, change(fleetLayoutOf(stored, project)))
  if (next === null) {
    $.ui.toast(gameStrings().text.layoutNewer)
    return false
  }
  await $.store.set(PANEL_LAYOUT_KEY, next)
  $.ui.invalidate('ui.render')
  return true
}
