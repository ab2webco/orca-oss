import type { EngineInterface } from 'claude-code'

import type { GameMode } from '../types'
import { forgetFrames } from './frame-gate'
import { configuredConfig, gameConfig, publishAbsorbing, quest } from './quest-runtime'

// What this session showed before flat, so the toggle returns to it; a reload starts over like /quest.
let modeBeforeFlat: GameMode | undefined

export const isFlatMode = (): boolean => gameConfig().mode === 'flat'

/** Drops every scene frame on screen, so nothing blits and `isSceneShown` turns false. */
export function dropScenes(): void {
  quest.stages.clear()
  quest.animations.clear()
  forgetFrames()
}

/** Flat and back, live, for this session; Orca's configured mode is unchanged. */
export async function toggleFlat($: EngineInterface): Promise<void> {
  if (isFlatMode()) {
    const back = modeBeforeFlat
    modeBeforeFlat = undefined
    quest.modeOverride = back ?? (configuredConfig().mode === 'flat' ? 'on' : undefined)
  } else {
    modeBeforeFlat = quest.modeOverride
    quest.modeOverride = 'flat'
    dropScenes()
  }
  $.ui.invalidate('ui.render')
  await publishAbsorbing($)
}
