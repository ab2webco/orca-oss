import { ORCHESTRATOR_GAME_SCENE_PHASES } from '../orchestrator-game-scene'

export const sceneLook = {
  skyTop: 0x4a7fc1,
  skyBottom: 0xa9d4f5,
  sun: 0xffe08a,
  isNight: false,
  far: 0x6d7f99,
  snow: 0xf2f5fa,
  near: 0x4f8a55,
  ground: 0x6b4f35,
  plant: 0x2f6b3a,
  plantKind: 'cactus',
  cloud: 0xf4f7fb
}

export const sceneCostume = {
  rows: ['..........', '..HHHHH...', '.HHHHHHH..', '.OEOOOEO..', 'OBBBBBBBO.', '.BBBBBBB..'],
  legs: ['.O.O.O.O..', 'O.O.O.O.O.'],
  colors: { O: 0xd77757, E: 0x1a1a1a, H: 0x3f6e46, B: 0x5f7f3a }
}

export const sceneCard = { icon: '✦', name: 'Pilot', color: '#7fa86a' }

export const byScenePhase = <T>(value: T): Record<string, T> =>
  Object.fromEntries(ORCHESTRATOR_GAME_SCENE_PHASES.map((phase) => [phase, value]))

/** A complete scene file as a plugin would ship it; override any top-level key. */
export function sceneFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    looks: byScenePhase(sceneLook),
    costumes: byScenePhase(sceneCostume),
    cards: byScenePhase(sceneCard),
    teller: { icon: '❝', name: 'Narrator', color: '#8f9bb3' },
    band: { gold: '#c9a24a', ink: '#1a1f33', panel: '#2b3150', parchment: '#f1e2b8' },
    ...overrides
  }
}
