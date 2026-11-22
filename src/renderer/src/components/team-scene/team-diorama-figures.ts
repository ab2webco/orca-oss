import type { DioramaKit } from './team-diorama-kit'
import { dioramaLiteUnit } from './team-diorama-unit-lite'
import { dioramaParts, type DioramaPart } from './team-diorama-unit-parts'
import type { TeamSceneFigureLook } from '../../../../shared/team-scene/team-scene-member-looks'
import { dioramaToonUnit, type DioramaUnit } from './team-diorama-units'

// Why chibi with an ink outline: the owner chose 3D figures that read like the illustrated ones,
// turning toward where they walk, with no swords (ORCA-1296). Low resources draws low-poly ones.

export type DioramaFigure = DioramaUnit & {
  /** Lowered while seated in a boat, raised on the tower; 0 on the ground. */
  baseY: number
  /** Its own part maker, so a tool handed to it later is drawn like the figure. */
  part: DioramaPart
}

/** The prototype's figures at 1.6 times their size, so their motion reads in a 350 px panel. */
export const DIORAMA_UNIT_SCALE = 1.6
const LEAD_SCALE = 1.12

/** The keep's mage: scenery, not on the Team list, so it keeps the prototype's navy robe. */
export const DIORAMA_MAGE_LOOK: TeamSceneFigureLook = {
  sheet: '',
  headwear: 'wizard',
  headwearColor: 0x26357e,
  trim: 0xe9c46a,
  hair: 0xeeeeee,
  beard: 0xeeeeee,
  skin: 0xf2c9a0,
  tunic: 0x26357e,
  pants: 0x1d2552,
  robe: true,
  cape: null,
  tool: 'staff'
}

/** Office 3D's look number until it follows the Team list sheets too (ORCA-1336, A2). */
export const dioramaLookOf = (seed: string): number => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  return (h >>> 0) % 36
}

/** Builds a figure dressed as `look`: the toon chibi with its outline, or the low-poly unit when `lite`. */
export function dioramaFigure(
  k: DioramaKit,
  look: TeamSceneFigureLook,
  opts: { lead?: boolean; lite: boolean }
): DioramaFigure {
  const part = dioramaParts(opts.lite)
  const unit = (opts.lite ? dioramaLiteUnit : dioramaToonUnit)(k, part, look)
  unit.g.scale.setScalar(DIORAMA_UNIT_SCALE * (opts.lead ? LEAD_SCALE : 1))
  return { ...unit, baseY: 0, part }
}
