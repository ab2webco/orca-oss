// The cast's pixel images (pose sprites, crown, hearts) and where they sit, shared by every library.
import {
  crownAtOf,
  crownPixel,
  CROWN_WIDTH,
  STATE_RING
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-party'
import type { MemberState } from '../../../../../resources/claude-plugins/orca-game/hooks/party-sprites'
import { costumeSpriteOf } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-sprite'
import type {
  SceneDefinition,
  ScenePhase
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import type { BandMember } from './band-scene'
import { castOf, spriteImageOf, type SpriteImage } from './hd2d-world'

export const MAX_HEARTS = 5
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'] as const
export const HEART_ON = 0xff4d6d
export const HEART_OFF = 0x4a4a5c
/** Emissive added to a lit heart and to a hurt member while its flash is on. */
export const HEART_GLOW = 0x331018
export const HURT_GLOW = 0x3a0c0c
export const BENCHED_TINT = 0x8a8a8a
/** A heart's size in world units, and the gap between heart centres. */
export const HEART_SIZE = { width: 2.1, height: 1.8, pitch: 2.3 } as const

export const heartImageOf = (color: number): SpriteImage => {
  const rgba = new Uint8ClampedArray(7 * 6 * 4)
  HEART.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === '#') {
        rgba.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255], (y * 7 + x) * 4)
      }
    })
  )
  return { width: 7, height: 6, rgba }
}

/** Centre of heart `slot`, from the member's feet, for a sprite `height` tall. */
export const heartAtOf = (slot: number, height: number): { x: number; y: number } => ({
  x: (slot - (MAX_HEARTS - 1) / 2) * HEART_SIZE.pitch,
  y: height + 2.5
})

/** The lead's crown and its centre relative to the sprite's bottom centre. */
export const crownOf = (
  scene: SceneDefinition,
  phase: ScenePhase,
  sprite: SpriteImage
): { image: SpriteImage; x: number; y: number } => {
  const at = crownAtOf(costumeSpriteOf(scene.costumes[phase], 0, false).rows, 0, 0)
  const rgba = new Uint8ClampedArray(CROWN_WIDTH * 2 * 4)
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < CROWN_WIDTH; x += 1) {
      const color = crownPixel(x, y, 0, 0)
      if (color !== undefined) {
        rgba.set(
          [(color >> 16) & 255, (color >> 8) & 255, color & 255, 255],
          (y * CROWN_WIDTH + x) * 4
        )
      }
    }
  }
  return {
    image: { width: CROWN_WIDTH, height: 2, rgba },
    x: at.left + CROWN_WIDTH / 2 - sprite.width / 2,
    y: sprite.height - at.top - 2
  }
}

const ringStateOf = (member: BandMember): MemberState =>
  member.state === 'waiting' ? 'waiting' : member.state === 'working' ? 'working' : 'idle'

export const isHurtFlashOn = (member: BandMember, t: number): boolean =>
  member.hurt && Math.sin(t / 90) > 0

export const ringOf = (member: BandMember): number => STATE_RING[ringStateOf(member)]
export const FIRST_RING = STATE_RING.working

/** Pose images keyed by phase, walk frame parity, sitting and state ring; each is made once. */
export const createPoseImages = <T>(
  scene: SceneDefinition,
  upload: (image: SpriteImage) => T
): {
  poseOf: (
    phase: ScenePhase,
    frame: number,
    isSitting: boolean,
    ring: number
  ) => { image: SpriteImage; texture: T }
  all: () => IterableIterator<{ image: SpriteImage; texture: T }>
} => {
  const made = new Map<string, { image: SpriteImage; texture: T }>()
  return {
    poseOf: (phase, frame, isSitting, ring) => {
      const key = `${phase}:${isSitting ? 's' : frame % 2}:${ring}`
      const kept = made.get(key)
      if (kept !== undefined) {
        return kept
      }
      const image = spriteImageOf(costumeSpriteOf(scene.costumes[phase], frame, isSitting), ring)
      const one = { image, texture: upload(image) }
      made.set(key, one)
      return one
    },
    all: () => made.values()
  }
}

/** Keeps each member in the costume it first wore, so a reshuffle never swaps outfits mid-walk. */
export const createWardrobe = (
  scene: SceneDefinition
): ((members: readonly BandMember[]) => ScenePhase[]) => {
  const worn = new Map<string, ScenePhase>()
  return (members: readonly BandMember[]): ScenePhase[] => {
    const order = castOf(scene, members)
    return members.map((member) => {
      const phase = worn.get(member.key) ?? order.get(member.key) ?? 'working'
      worn.set(member.key, phase)
      return phase
    })
  }
}
