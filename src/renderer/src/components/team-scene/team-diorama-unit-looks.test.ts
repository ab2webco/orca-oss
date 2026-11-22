import type * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  FIGURES_ADVISOR_LOOK,
  FIGURES_LEAD_LOOK,
  FIGURES_MEMBER_LOOKS,
  type TeamSceneHeadwear
} from '../../../../shared/team-scene/team-scene-member-looks'
import { DAY, dioramaKit } from './team-diorama-kit'
import { dioramaFigure } from './team-diorama-figures'

const kit = () =>
  dioramaKit(DAY, { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' })

// Read off each sheet's first frame by eye, not from the looks table, so a wrong shape fails.
const DRAWN: Record<string, string[]> = {
  'figures/lead.png': ['headwear:crown', 'cape', 'tool:banner'],
  'figures/advisor.png': ['headwear:wizard', 'beard', 'tool:staff'],
  'figures/member-1.png': ['headwear:helm', 'cape'],
  'figures/member-2.png': ['headwear:headband', 'beard', 'tool:hammer'],
  'figures/member-3.png': ['headwear:hood', 'cape', 'tool:bow'],
  'figures/member-4.png': ['headwear:wizard', 'tool:wand'],
  'figures/member-5.png': ['headwear:cap', 'cape'],
  'figures/member-6.png': ['headwear:hair', 'tool:staff'],
  'figures/member-7.png': ['headwear:hood', 'cape'],
  'figures/member-8.png': ['headwear:cap']
}
const LOOKS = [FIGURES_LEAD_LOOK, FIGURES_ADVISOR_LOOK, ...FIGURES_MEMBER_LOOKS]

const shapeParts = (g: THREE.Object3D) => {
  const names = new Set<string>()
  g.traverse((o) => {
    if (/^(headwear:|tool:|beard$|cape$)/.test(o.name)) {
      names.add(o.name)
    }
  })
  return [...names].sort()
}

describe('the shape of each figure', () => {
  it.each(LOOKS.flatMap((look) => [false, true].map((lite) => ({ look, lite }))))(
    'draws the headwear, beard, cape and tool of $look.sheet (lite: $lite)',
    ({ look, lite }) => {
      const parts = shapeParts(dioramaFigure(kit(), look, { lite }).g)
      expect(parts).toEqual([...DRAWN[look.sheet]!].sort())
    }
  )

  it('gives each headwear its own silhouette at Low resources, not one shared ball', () => {
    const silhouettes = new Map<TeamSceneHeadwear, string>()
    for (const look of LOOKS) {
      const sig: string[] = []
      dioramaFigure(kit(), look, { lite: true }).g.traverse((o) => {
        const geo = (o as THREE.Mesh).geometry as
          | (THREE.BufferGeometry & { parameters?: object })
          | undefined
        if (geo && o.name.startsWith('headwear:')) {
          sig.push(`${geo.type}${JSON.stringify(geo.parameters)}`)
        }
      })
      silhouettes.set(look.headwear, sig.sort().join('|'))
    }
    expect(silhouettes.size).toBe(7)
    expect(new Set(silhouettes.values()).size).toBe(7)
  })
})
