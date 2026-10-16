import type { LocalizedName } from '../game-strings'
import type { FlowPhase } from '../quest-policy'

export type ScenePhase = FlowPhase | 'working'

export const PLANT_KINDS = ['tree', 'cactus', 'none', 'antenna', 'crystal', 'flower'] as const
export type PlantKind = (typeof PLANT_KINDS)[number]

// The far layer behind the hills; `peaks` when a look leaves it out.
export const SCENERIES = ['peaks', 'skyline', 'crystals', 'meadow'] as const
export type Scenery = (typeof SCENERIES)[number]

export type Look = {
  skyTop: number
  skyBottom: number
  sun: number
  isNight: boolean
  far: number
  snow: number
  near: number
  ground: number
  plant: number
  plantKind: PlantKind
  cloud: number
  scenery?: Scenery
  /** A searchlight sign in place of the sun, its beam slanting down. */
  isSignal?: boolean
}

// Ten columns wide; each glyph names a key of `colors`, '.' is transparent.
export type Costume = {
  rows: readonly string[]
  legs: readonly [string, string]
  colors: Readonly<Record<string, number>>
}

export type Card = { icon: string; name: LocalizedName; color: string }

export type BandPalette = { gold: string; ink: string; panel: string; parchment: string }

export type SceneDefinition = {
  id: string
  looks: Readonly<Record<ScenePhase, Look>>
  costumes: Readonly<Record<ScenePhase, Costume>>
  cards: Readonly<Record<ScenePhase, Card>>
  teller: Card
  band: BandPalette
  /** Faces a teammate whose CI is red, on its tile and in turns with it on the HUD. */
  foe?: Costume
  /** Caption painted while a merge runs; pixel art, so width-1 characters only. */
  finale?: LocalizedName
}
