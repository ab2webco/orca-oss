import type {
  AdvisorGesture,
  CharacterAccessory,
  LocalizedName,
  PlantKind,
  SceneCharacter,
  Scenery
} from '../../types'

export type {
  AdvisorGesture,
  BandPalette,
  Card,
  CastFrame,
  CharacterAccessory,
  CharacterVariant,
  Costume,
  HudPalette,
  Look,
  LookColor,
  PlantKind,
  SceneAdvisor,
  SceneCast,
  SceneCharacter,
  SceneDefinition,
  ScenePet,
  ScenePhase,
  SceneTheme,
  Scenery
} from '../../types'

// Records, so the type check fails when the contract's unions and these lists drift.
const PLANT_KIND_SET: Readonly<Record<PlantKind, true>> = {
  tree: true,
  cactus: true,
  none: true,
  antenna: true,
  crystal: true,
  flower: true
}
export const PLANT_KINDS = Object.keys(PLANT_KIND_SET) as readonly PlantKind[]

const SCENERY_SET: Readonly<Record<Scenery, true>> = {
  peaks: true,
  skyline: true,
  crystals: true,
  meadow: true
}
export const SCENERIES = Object.keys(SCENERY_SET) as readonly Scenery[]

const ADVISOR_GESTURE_SET: Readonly<Record<AdvisorGesture, true>> = {
  lowered: true,
  raised: true,
  approved: true,
  unsure: true,
  escalated: true,
  ciRunning: true,
  ciPassed: true,
  ciFailed: true,
  stopped: true,
  consulting: true,
  advised: true
}
export const ADVISOR_GESTURES = Object.keys(ADVISOR_GESTURE_SET) as readonly AdvisorGesture[]

// Why: a cast member stands on the ground under the bubble row, as tall as the hero at most.
export const CAST_MAX_ROWS = 7
export const CAST_MAX_WIDTH = 10
export const CAST_MAX_FRAMES = 4

/** A roster character in the phase costumes, under its own palette and accessory. */
export const sceneCharacter = (
  name: LocalizedName,
  colors: Readonly<Record<string, number>>,
  accessory: CharacterAccessory,
  accessoryColor: number
): SceneCharacter => ({ name, variant: { colors, accessory, accessoryColor } })
