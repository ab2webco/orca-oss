import type { DioramaKit } from './team-diorama-kit'
import { dioramaLiteUnit } from './team-diorama-unit-lite'
import { dioramaParts, type DioramaPart } from './team-diorama-unit-parts'
import {
  DIORAMA_COSTUMES,
  DIORAMA_HAIR,
  DIORAMA_SKIN,
  dioramaToonUnit,
  type DioramaRole,
  type DioramaUnit
} from './team-diorama-units'

// Why chibi with an ink outline: the owner chose 3D figures that read like the illustrated ones,
// turning toward where they walk, with no swords (ORCA-1296). Low resources draws low-poly ones.

export type { DioramaRole } from './team-diorama-units'
export type DioramaFigure = DioramaUnit & {
  /** Lowered while seated in a boat, raised on the tower; 0 on the ground. */
  baseY: number
  /** Its own part maker, so a tool handed to it later is drawn like the figure. */
  part: DioramaPart
}

/** The prototype's figures at 1.6 times their size, so their motion reads in a 350 px panel. */
export const DIORAMA_UNIT_SCALE = 1.6
const LEAD_SCALE = 1.12

/** A member's look, kept by its persistent character (or its pane) like the image styles do. */
export const dioramaLookOf = (seed: string): number => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  return (h >>> 0) % 36
}

/** Builds a figure: the toon chibi with its outline, or the low-poly unit when `lite`. */
export function dioramaFigure(
  k: DioramaKit,
  look: number,
  opts: { lead?: boolean; role?: 'advisor' | 'mage'; lite: boolean }
): DioramaFigure {
  const role: DioramaRole = opts.lead
    ? 'lead'
    : (opts.role ?? DIORAMA_COSTUMES[look % DIORAMA_COSTUMES.length]!)
  const skin = DIORAMA_SKIN[look % DIORAMA_SKIN.length]!
  const hair = DIORAMA_HAIR[Math.floor(look / 6) % DIORAMA_HAIR.length]!
  const part = dioramaParts(opts.lite)
  const unit = (opts.lite ? dioramaLiteUnit : dioramaToonUnit)(k, part, role, skin, hair)
  unit.g.scale.setScalar(DIORAMA_UNIT_SCALE * (opts.lead ? LEAD_SCALE : 1))
  return { ...unit, baseY: 0, part }
}
