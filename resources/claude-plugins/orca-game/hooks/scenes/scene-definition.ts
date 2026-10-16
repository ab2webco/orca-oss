import type { PlantKind, Scenery } from '../../types'

export type {
  BandPalette,
  Card,
  Costume,
  Look,
  PlantKind,
  SceneDefinition,
  ScenePhase,
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
