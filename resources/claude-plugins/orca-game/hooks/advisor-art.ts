import type { AdvisorGesture, SceneAdvisor, SceneDefinition } from './scenes/index'

// Jev's advisor: the referee a scene gets when it brings none, and the props every advisor holds.

export const ADVISOR_PROP_WIDTH = 5

const BLACK = 0x1a1a1a
const SKIN = 0xe2b48c
const WHITE = 0xf4f4f4

/** Black-and-white stripes, a cap and a whistle; it faces left, toward the field and its props. */
export const REFEREE: SceneAdvisor = {
  name: { en: 'Referee', es: 'Árbitro', ja: '審判', ko: '심판', zh: '裁判' },
  frames: [
    ['..KKKK..', '.KKKKK..', '.GSESS..', '.WKWKWK.', 'SWKWKWKS', '..KKKK..', '..K..K..'],
    ['..KKKK..', '.KKKKK..', '.GSESS..', '.WKWKWK.', 'SWKWKWKS', '..KKKK..', '..K..K..'],
    ['..KKKK..', '.KKKKK..', '.GSESS..', '.WKWKWK.', 'SWKWKWKS', '..KKKK..', '..K..K..'],
    ['..KKKK..', '.KKKKK..', '.GSSSS..', '.WKWKWK.', 'SWKWKWKS', '..KKKK..', '..K..K..']
  ],
  colors: { K: BLACK, S: SKIN, E: BLACK, W: WHITE, G: 0xc3ccd6 }
}

// Nine pixel rows from the top of the scene to just above the ground, five columns, '.' clear.
// Why nothing above row 2: the top two rows are the bubbles' line, which would hide a prop.
type Prop = readonly string[]

const PROP_COLORS: Readonly<Record<string, number>> = {
  S: SKIN,
  W: WHITE,
  D: 0x7fd36a,
  U: 0xffb347,
  Y: 0xffd84a,
  R: 0xd83a2e,
  M: 0x8a8f99,
  L: 0x9fd8ff,
  C: 0xc3ccd6,
  K: BLACK,
  F: 0x3fae6f,
  P: 0x8a6a3a
}

const DOWN: Prop = ['.....', '.....', '..D..', '..D..', '..D.S', 'DDDDD', '.DDD.', '..D..', '.....']
const UP: Prop = ['.....', '.....', '..U..', '.UUU.', 'UUUUU', '..U.S', '..U..', '..U..', '.....']
const THUMB: Prop = [
  '.....',
  '.....',
  '.....',
  '..S..',
  '..S..',
  '.SSSS',
  '.SSS.',
  '.SSS.',
  '.....'
]
const UNSURE: Prop = [
  '.....',
  '.....',
  '...YY',
  '...YY',
  '...YY',
  '.MMM.',
  '.MLM.',
  '.MMM.',
  '...M.'
]
const RED_CARD: Prop = [
  '.....',
  '.....',
  '...RR',
  '...RR',
  '...RR',
  '....S',
  '.....',
  '.....',
  '.....'
]
const WATCH: Prop = [
  '.....',
  '.....',
  '.....',
  '..C..',
  '.CCC.',
  'CWWWC',
  'CWKWC',
  'CWWWC',
  '.CCC.'
]
const FLAG: readonly Prop[] = [
  ['.....', '.....', '.FFFP', 'FFFFP', '.FFFP', '....P', '....S', '.....', '.....'],
  ['.....', '.....', 'FFF.P', '.FFFP', 'FFF.P', '....P', '....S', '.....', '.....']
]
const HAND_OF_WATCH: readonly (readonly [number, number])[] = [
  [2, 5],
  [3, 6],
  [2, 7],
  [1, 6]
]

const propPixel = (prop: Prop, dx: number, y: number, colors = PROP_COLORS): number | undefined => {
  const glyph = prop[y]?.[dx]
  return glyph === undefined || glyph === '.' ? undefined : colors[glyph]
}

/** What the advisor holds out for a gesture, `dx` columns from the left of the prop columns. */
export const advisorPropPixel = (
  gesture: AdvisorGesture,
  dx: number,
  y: number,
  age: number
): number | undefined => {
  if (dx < 0 || dx >= ADVISOR_PROP_WIDTH) {
    return undefined
  }
  const beat = Math.floor(age / 3)
  switch (gesture) {
    // Both arrows bob down a pixel, so neither reaches the bubbles' line.
    case 'lowered':
      return propPixel(DOWN, dx, y - (beat % 2))
    case 'raised':
      return propPixel(UP, dx, y - (beat % 2))
    case 'approved':
      // The whistle's toot, above the thumb.
      return y === 2 && dx === beat % 3 ? WHITE : propPixel(THUMB, dx, y)
    case 'unsure': {
      // The magnifier sweeps a column back and forth under the card.
      const sweep = y >= 5 && beat % 2 === 1 ? 1 : 0
      return propPixel(UNSURE, dx + sweep, y)
    }
    case 'escalated':
      // A long whistle: its blast streams out the whole time the card is up.
      return y === 4 && dx < 3 && (dx + beat) % 3 !== 0 ? WHITE : propPixel(RED_CARD, dx, y)
    case 'ciRunning': {
      const hand = HAND_OF_WATCH[beat % HAND_OF_WATCH.length]
      return hand !== undefined && hand[0] === dx && hand[1] === y ? BLACK : propPixel(WATCH, dx, y)
    }
    case 'ciPassed':
    case 'ciFailed': {
      const cloth = gesture === 'ciPassed' ? PROP_COLORS.F : PROP_COLORS.R
      const flag = FLAG[beat % FLAG.length] ?? []
      return propPixel(flag, dx, y, { ...PROP_COLORS, F: cloth ?? WHITE, P: 0x8a8f99 })
    }
  }
}

/** Who stands for Jev in a scene: its own advisor, else the referee. */
export const advisorSpriteOf = (scene: SceneDefinition): SceneAdvisor =>
  scene.cast?.advisor ?? REFEREE
