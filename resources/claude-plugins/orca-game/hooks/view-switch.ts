import type { EngineInterface } from 'claude-code'

import { dropScenes } from './flat-toggle'
import { refreshSoon, storeGameView, viewOf } from './fleet-sync'
import { gameViewOf, gameViewPatchOf, type GameViewId } from './game-view'
import { isSceneMode } from './quest-policy'
import { gameConfig, publishAbsorbing, quest, questLiveConfig } from './quest-runtime'
import { viewWords, type ViewScope } from './view-words'

/** The view this pane shows now, its own override included. */
export const currentView = (): GameViewId => gameViewOf(gameConfig())

/** What this pane can pick: always itself, then the scopes Orca can store; and the suggested view. */
export async function viewChoicesOf(
  $: EngineInterface
): Promise<{ scopes: ViewScope[]; suggested: GameViewId | undefined }> {
  const state = (await viewOf($)).state
  return { scopes: ['pane', ...(state?.viewScopes ?? [])], suggested: state?.suggestedView }
}

async function redraw($: EngineInterface): Promise<void> {
  if (!isSceneMode(gameConfig().mode)) {
    dropScenes()
  }
  $.ui.invalidate('ui.render')
  await publishAbsorbing($)
}

function setPaneView(view: GameViewId): void {
  const patch = gameViewPatchOf(view, gameConfig())
  quest.isDemo = false
  quest.modeOverride = patch.mode ?? quest.modeOverride
  quest.renderOverride = patch.render ?? quest.renderOverride
}

/** Shows a view in this pane, or stores it in Orca and lets this pane follow Orca again. */
export async function switchView(
  $: EngineInterface,
  view: GameViewId,
  scope: ViewScope
): Promise<string> {
  const words = viewWords()
  const name = words.names[view]
  if (scope === 'pane') {
    setPaneView(view)
    await redraw($)
    return words.setPane(name)
  }
  const isStored =
    (await viewChoicesOf($)).scopes.includes(scope) && (await storeGameView($, view, scope))
  if (!isStored) {
    // Why still this pane: an older Orca, or a remote CLI without `game view`, cannot store it.
    setPaneView(view)
    await redraw($)
    return words.notStored(name, scope)
  }
  // Why drop the override: this pane must follow what it just stored, and later changes from Settings.
  quest.isDemo = false
  quest.modeOverride = undefined
  quest.renderOverride = undefined
  // Why: every project sits under this project's own layers, so a value they set keeps winning here.
  const isShadowed =
    scope === 'global' &&
    [quest.liveSources.mode, quest.liveSources.render].some(
      (source) => source === 'project' || source === 'local'
    )
  if (!isShadowed) {
    const patch = gameViewPatchOf(view, gameConfig())
    questLiveConfig($, { ...quest.liveConfig, ...patch }, quest.liveSources)
  }
  await redraw($)
  await refreshSoon($)
  return isShadowed
    ? words.storedShadowed(name, words.names[currentView()])
    : words.stored(name, scope)
}
