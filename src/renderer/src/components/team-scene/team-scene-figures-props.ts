import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import {
  PILE_FROM_SEAT_X,
  SITE_FROM_SEAT_X,
  type TeamSceneSiteView
} from '../../../../shared/team-scene/team-scene-sites'
import type { TeamSceneSpot } from '../../../../shared/team-scene/team-scene-types'

export type FiguresPropKind = 'campfire' | 'anvil' | 'lectern' | 'flag'

/** A prop's spot on the Figures ground: `x` is where it stands, `left`/`right` its drawn edges, in px. */
export type FiguresProp = {
  kind: FiguresPropKind
  x: number
  depth: number
  left: number
  right: number
}

type Box = { left: number; right: number }

// Why these: prototype V30's drawProps, at its x and depth, with each prop's drawn reach from its x.
const PROPS: { kind: FiguresPropKind; x: number; depth: number; from: number; to: number }[] = [
  { kind: 'campfire', x: 0.075, depth: 0.4, from: -13, to: 13 },
  { kind: 'anvil', x: 0.125, depth: 0.4, from: -9, to: 9 },
  { kind: 'lectern', x: 0.655, depth: 0.2, from: -10, to: 10 },
  { kind: 'flag', x: 0.9, depth: 0.3, from: -2, to: 25 }
]
// Why a neighbourhood: past it the prop no longer reads as V30's; it is left out instead.
const REACH = 0.15
const TOWER_SCALE = 1.5

/** The castle sites, stone piles and stations drawn on the ground, as px spans. */
export function figuresStaticArtOf(stage: {
  width: number
  sites: readonly TeamSceneSiteView[]
  stations: readonly TeamSceneSpot[]
}): Box[] {
  const { width: w } = stage
  const builds = stage.sites.flatMap((site) => {
    const k = teamSceneScaleAt(site.spot.depth) * TOWER_SCALE
    const x = site.spot.x * w
    const pile = (site.spot.x - SITE_FROM_SEAT_X - PILE_FROM_SEAT_X) * w
    return [
      { left: x - 14 * k, right: x + 22 * k },
      { left: pile - 8 * k, right: pile + 8 * k }
    ]
  })
  // Why every station: the Figures art draws its station centred on each seat, builds or not.
  const stations = stage.stations.map((spot) => {
    const s = teamSceneScaleAt(spot.depth)
    return { left: spot.x * w - 18 * s, right: spot.x * w + 18 * s }
  })
  return [...builds, ...stations]
}

/**
 * V30's props for this stage: each at its own x, else the nearest spot clear of the static art, else
 * left out. Actors stand in front of them, so actors are not avoided.
 */
export function figuresPropsOf(stage: {
  width: number
  sites: readonly TeamSceneSiteView[]
  stations: readonly TeamSceneSpot[]
}): FiguresProp[] {
  const { width: w } = stage
  const art = figuresStaticArtOf(stage)
  const placed: FiguresProp[] = []
  for (const prop of PROPS) {
    const home = prop.x * w
    const fits = (x: number): boolean => {
      const box = { left: x + prop.from, right: x + prop.to }
      return (
        box.left >= 0 &&
        box.right <= w &&
        art.every((one) => one.right <= box.left || box.right <= one.left)
      )
    }
    let x: number | null = null
    for (let d = 0; d <= REACH * w && x === null; d++) {
      x = fits(home - d) ? home - d : fits(home + d) ? home + d : null
    }
    if (x !== null) {
      // Why props may touch: V30's anvil stands against its campfire.
      placed.push({
        kind: prop.kind,
        x,
        depth: prop.depth,
        left: x + prop.from,
        right: x + prop.to
      })
    }
  }
  return placed
}
