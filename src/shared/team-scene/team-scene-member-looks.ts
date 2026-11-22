import type { TeamSceneActor } from './team-scene-types'

// Why one table: the Team list face is a member sheet, and the 3D figure follows it (ORCA-1336).
// Colours are sampled from each sheet; the test checks them against the PNG.

export type TeamSceneHeadwear = 'crown' | 'wizard' | 'helm' | 'hood' | 'headband' | 'cap' | 'hair'
/** No sword: the owner chose 3D figures with none (ORCA-1296), so a sword reads as empty hands. */
export type TeamSceneFigureTool = 'banner' | 'hammer' | 'bow' | 'wand' | 'staff' | 'none'

export type TeamSceneFigureLook = {
  /** The sheet under quest-art this look is read from. */
  sheet: string
  headwear: TeamSceneHeadwear
  headwearColor: number
  /** Belt, hat band, plume, feather or orb: the sheet's accent. */
  trim: number
  hair: number
  beard: number | null
  skin: number
  tunic: number
  pants: number
  robe: boolean
  cape: number | null
  tool: TeamSceneFigureTool
}

const look = (sheet: string, rest: Omit<TeamSceneFigureLook, 'sheet'>): TeamSceneFigureLook => ({
  sheet: `figures/${sheet}.png`,
  ...rest
})
const BASE = { beard: null, robe: false, cape: null, tool: 'none' } as const

export const FIGURES_LEAD_LOOK = look('lead', {
  ...BASE,
  headwear: 'crown',
  headwearColor: 0xf2c94c,
  trim: 0xf2c94c,
  hair: 0x683820,
  skin: 0xf1c6a0,
  tunic: 0x2f5fb3,
  pants: 0x2a2d3d,
  cape: 0xb3263a,
  tool: 'banner'
})

export const FIGURES_ADVISOR_LOOK = look('advisor', {
  ...BASE,
  headwear: 'wizard',
  headwearColor: 0xa37e26,
  trim: 0xfff1c2,
  hair: 0xf8f0c0,
  beard: 0xf8f0c0,
  skin: 0xe0b088,
  tunic: 0xc09828,
  pants: 0x876a21,
  robe: true,
  tool: 'staff'
})

/** In the sheets' order, so `member-N.png` is entry N - 1. */
export const FIGURES_MEMBER_LOOKS: readonly TeamSceneFigureLook[] = [
  look('member-1', {
    ...BASE,
    headwear: 'helm',
    headwearColor: 0xcdd3dc,
    trim: 0x3f6fb5,
    hair: 0x4a3324,
    skin: 0xf1c6a0,
    tunic: 0xa2a9b5,
    pants: 0x404858,
    cape: 0x3a5b8c
  }),
  look('member-2', {
    ...BASE,
    headwear: 'headband',
    headwearColor: 0xc23b34,
    trim: 0xc23b34,
    hair: 0x3a2824,
    beard: 0x2a1a12,
    skin: 0xd9a077,
    tunic: 0x7f6049,
    pants: 0x2a2d3d,
    tool: 'hammer'
  }),
  look('member-3', {
    ...BASE,
    headwear: 'hood',
    headwearColor: 0x2b6143,
    trim: 0xc9a24b,
    hair: 0x4a3324,
    skin: 0xe0b088,
    tunic: 0x518d66,
    pants: 0x423223,
    cape: 0x2b6143,
    tool: 'bow'
  }),
  look('member-4', {
    ...BASE,
    headwear: 'wizard',
    headwearColor: 0x4b348a,
    trim: 0xc7b3ff,
    hair: 0xc8b8a0,
    skin: 0xf1c6a0,
    tunic: 0x6651a0,
    pants: 0x3f2d73,
    robe: true,
    tool: 'wand'
  }),
  look('member-5', {
    ...BASE,
    headwear: 'cap',
    headwearColor: 0x7a1f1c,
    trim: 0xf2c94c,
    hair: 0x3e2b28,
    skin: 0xb87850,
    tunic: 0xaa4844,
    pants: 0x2a1a1a,
    cape: 0x7a1f1c
  }),
  look('member-6', {
    ...BASE,
    headwear: 'hair',
    headwearColor: 0xa85828,
    trim: 0x3f8f8a,
    hair: 0xa85828,
    skin: 0xf1c6a0,
    tunic: 0xcdc7b8,
    pants: 0x9b9688,
    robe: true,
    tool: 'staff'
  }),
  look('member-7', {
    ...BASE,
    headwear: 'hood',
    headwearColor: 0x1d4f55,
    trim: 0xd8efe9,
    hair: 0x1f1a16,
    skin: 0x885838,
    tunic: 0x458086,
    pants: 0x1e292b,
    cape: 0x1d4f55
  }),
  look('member-8', {
    ...BASE,
    headwear: 'cap',
    headwearColor: 0xfbe3a8,
    trim: 0xfbe3a8,
    hair: 0x101008,
    skin: 0xd8a070,
    tunic: 0xa07944,
    pants: 0x352a1a
  })
]

/** FNV-1a: stable across hosts and runs, so a character keeps its look everywhere. */
export function teamSceneLookSeedOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

/** A member's look follows its persistent character, not its pane, as its Team list face does. */
export function teamSceneMemberLookOf(
  who: Pick<TeamSceneActor, 'role' | 'key' | 'characterKey'>
): TeamSceneFigureLook {
  if (who.role === 'lead') {
    return FIGURES_LEAD_LOOK
  }
  if (who.role === 'advisor') {
    return FIGURES_ADVISOR_LOOK
  }
  const seed = teamSceneLookSeedOf(who.characterKey ?? who.key)
  return FIGURES_MEMBER_LOOKS[seed % FIGURES_MEMBER_LOOKS.length]!
}
