import type { FlowPhase } from '../quest-policy'

export type ScenePhase = FlowPhase | 'working'

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
  plantKind: 'tree' | 'cactus' | 'none'
  cloud: number
}

// Ten columns wide; each glyph names a key of `colors`, '.' is transparent.
export type Costume = {
  rows: readonly string[]
  legs: readonly [string, string]
  colors: Readonly<Record<string, number>>
}

export type Card = { icon: string; name: string; color: string }

export type BandPalette = { gold: string; ink: string; panel: string; parchment: string }

export type SceneDefinition = {
  id: string
  looks: Readonly<Record<ScenePhase, Look>>
  costumes: Readonly<Record<ScenePhase, Costume>>
  cards: Readonly<Record<ScenePhase, Card>>
  teller: Card
  band: BandPalette
}
