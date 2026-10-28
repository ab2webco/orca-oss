import { sceneCharacter, type SceneDefinition } from './scene-definition'

const EYES = 0x1a1a1a
const FACE = 0xf0c9a0
const MERC_HAIR = 0xf2d35a
const NAVY = 0x2f3a6b
const STEEL = 0xd0d6de

// A party member's face, and the hair, hood or helmet each phase's costume wears.
const member = (
  name: string,
  face: number,
  hair: number,
  ...accessory: [Parameters<typeof sceneCharacter>[2], number]
) => sceneCharacter(name, { S: face, Y: hair, P: hair, G: hair, A: hair }, ...accessory)

const CHARACTERS = [
  member('Kael', 0xf3d2b0, 0xd83a2e, 'horns', 0xe8e0c8),
  member('Lyra', 0xe8b890, 0x5fb8ff, 'bow', 0xff7ab0),
  member('Riven', 0xc08860, 0x2a2a3a, 'feather', 0x9a3ad0),
  member('Sora', 0xf6dcc4, 0x7fe0ff, 'halo', 0xfff3a0),
  member('Thane', 0x9a6440, 0x8a8a8a, 'horns', 0xb89a70),
  member('Mira', 0xf0c8a0, 0xf878c8, 'bow', 0xffffff),
  member('Elara', 0xd8a878, 0xf4f0d0, 'crown', 0xffd84a),
  member('Bryn', 0xb07850, 0xe07a2a, 'cape', 0x3a6ad0),
  member('Corin', 0x7a4a2a, 0x4a8a3a, 'antenna', 0x9ae07a),
  member('Faye', 0xfadcc0, 0x9a6ad0, 'feather', 0x4fc3f7),
  member('Zephyr', 0xe0b080, 0x4fd8b0, 'cape', 0xd8f0ff)
]

// Crystal Saga by Jucer Orozco (koombea/cineco-orchestrator PR #32): a JRPG party crossing
// crystal spires, and a silver-haired rival on red CI.
export const JRPG_SCENE: SceneDefinition = {
  id: 'jrpg',
  looks: {
    working: {
      skyTop: 0x2f5fa8,
      skyBottom: 0x9fd0f0,
      sun: 0xfff4c0,
      isNight: false,
      far: 0x4a5f8a,
      snow: 0xbff0ff,
      near: 0x3f7a5a,
      ground: 0x5a4a3a,
      plant: 0x7fe0ff,
      plantKind: 'crystal',
      cloud: 0xf0f6ff,
      scenery: 'crystals'
    },
    docs: {
      skyTop: 0x4a2a7a,
      skyBottom: 0xe08ac0,
      sun: 0xffd0f0,
      isNight: false,
      far: 0x5a3a8a,
      snow: 0xf0c0ff,
      near: 0x3a3a6a,
      ground: 0x2a2440,
      plant: 0xd08aff,
      plantKind: 'crystal',
      cloud: 0xf0b0e0,
      scenery: 'crystals'
    },
    build: {
      skyTop: 0x1f4a3a,
      skyBottom: 0x8ad0a0,
      sun: 0xe0ffd0,
      isNight: false,
      far: 0x2f5a4a,
      snow: 0xa0ffd0,
      near: 0x2a5a3a,
      ground: 0x3a3a2a,
      plant: 0x6fffb0,
      plantKind: 'crystal',
      cloud: 0xd0f0e0,
      scenery: 'crystals'
    },
    verify: {
      skyTop: 0x3a0a14,
      skyBottom: 0xa83a3a,
      sun: 0xff6a4a,
      isNight: false,
      far: 0x4a1a24,
      snow: 0xff9a8a,
      near: 0x2a1418,
      ground: 0x1a0c10,
      plant: 0xff5a6a,
      plantKind: 'crystal',
      cloud: 0x8a2a30,
      scenery: 'crystals'
    },
    pr: {
      skyTop: 0x2a3a7a,
      skyBottom: 0xffb070,
      sun: 0xffe08a,
      isNight: false,
      far: 0x4a4a8a,
      snow: 0xffe0c0,
      near: 0x3a4a5a,
      ground: 0x3a2a2a,
      plant: 0xffd08a,
      plantKind: 'crystal',
      cloud: 0xffc8a0,
      scenery: 'crystals'
    },
    handoff: {
      skyTop: 0x060a24,
      skyBottom: 0x1a2a5a,
      sun: 0xe0ecff,
      isNight: true,
      far: 0x1a2048,
      snow: 0x9ad8ff,
      near: 0x10182a,
      ground: 0x0a0e1a,
      plant: 0x5ab8ff,
      plantKind: 'crystal',
      cloud: 0x2a3466,
      scenery: 'crystals'
    }
  },
  costumes: {
    working: {
      rows: ['Y.Y.Y...B.', 'YYYYYY..B.', 'YSSSSY..B.', '.SQSQS..B.', 'NNNNNNNNH.', '.NNNNNN...'],
      legs: ['.N.N.N....', 'N.N.N.N...'],
      colors: { Y: MERC_HAIR, S: FACE, Q: 0x5fb8ff, B: STEEL, H: 0x6b4a2b, N: NAVY }
    },
    docs: {
      rows: ['....P...O.', '...PPP..T.', '..PPPPP.T.', '.PSQSQSPT.', 'PPRRRRRPT.', '.RRRRRRRT.'],
      legs: ['.RRRRRRR..', 'RRRRRRRRR.'],
      colors: { P: 0x6a3fb0, O: 0x7fe0ff, T: 0x7a5230, S: FACE, Q: 0xffd84a, R: 0x4a2a80 }
    },
    build: {
      rows: ['..........', '..GGGGG...', '.GGGGGGGG.', '.SQSSSQS..', 'VVVVVVVVD.', '.VVBVVV...'],
      legs: ['.V.V.V.V..', 'V.V.V.V.V.'],
      colors: { G: 0x2fa38a, S: FACE, Q: EYES, V: 0x3f7a4a, D: STEEL, B: 0x6b4a2b }
    },
    verify: {
      rows: ['...WWWW...', '..WWWWWW..', '..WSSSSW..', '..WQSQSW.T', '.WWGWGWW.T', '.WWWWWWW.T'],
      legs: ['.WWWWWWW..', 'WWWWWWWWW.'],
      colors: { W: 0xf2f0ea, S: FACE, Q: 0x3a8fd6, G: 0xd8b23c, T: 0xb08a5a }
    },
    pr: {
      rows: ['........I.', '..AAAAA.I.', '.AAAAAAAI.', '.ASQSQSAI.', 'BBBBBBBBI.', '.BBBBBBB..'],
      legs: ['.B.B.B.B..', 'B.B.B.B.B.'],
      colors: { A: 0x3f5fa8, I: STEEL, S: FACE, Q: EYES, B: 0x2f4a80 }
    },
    handoff: {
      rows: ['Y.Y.YB....', 'YYYYYB....', 'YSSSSY....', '.SQSQS....', 'NNNNNNN...', '.NNNNNN...'],
      legs: ['N.N.N.N...', '.N.N.N....'],
      colors: { Y: MERC_HAIR, S: FACE, Q: 0x5fb8ff, B: STEEL, N: NAVY }
    }
  },
  cards: {
    working: {
      icon: '⚔',
      name: { en: 'Mercenary', es: 'Mercenario' },
      color: '#f2d35a'
    },
    docs: {
      icon: '✦',
      name: { en: 'Mage', es: 'Mago' },
      color: '#9a7fe0'
    },
    build: {
      icon: '†',
      name: { en: 'Thief', es: 'Ladrón' },
      color: '#2fa38a'
    },
    verify: {
      icon: '✚',
      name: { en: 'Healer', es: 'Sanadora' },
      color: '#f2f0ea'
    },
    pr: {
      icon: '↑',
      name: { en: 'Lancer', es: 'Lancero' },
      color: '#5b8fd6'
    },
    handoff: {
      icon: '★',
      name: { en: 'Hero', es: 'Héroe' },
      color: '#ff7a59'
    }
  },
  teller: {
    icon: '❝',
    name: { en: 'Chronicler', es: 'Cronista' },
    color: '#aab4e8'
  },
  band: { gold: '#e8ecff', ink: '#1b2a8a', panel: '#0d1650', parchment: '#ffffff' },
  foe: {
    rows: ['.WWWWW....', 'WWWWWWW...', 'WSSSSSW...', 'WSQSQSWLLL', 'KKKKKKKL..', 'WKKKKKK...'],
    legs: ['.K.K.K.K..', 'K.K.K.K.K.'],
    colors: { W: 0xdfe3ea, S: 0xf3dcc8, Q: 0x5fd38a, L: 0xc8ced8, K: 0x15161c }
  },
  // Why ★: PR #32 framed it with ♪, which is outside the characters a Raster is known to draw.
  finale: { en: '★ VICTORY ★', es: '★ ¡VICTORIA! ★' },
  // Jev's advisor: a hooded oracle whose orb flickers while it reads the signs.
  // Orca's built-in roster for the scene; its first name wears the phase costumes as they are.
  roster: ['Aerin', ...CHARACTERS.map((one) => one.name)],
  characters: CHARACTERS,
  cast: {
    advisor: {
      name: { en: 'Oracle', es: 'Oráculo' },
      frames: [
        ['...BB...', '..BBBB..', '.BBSEB..', '.BBSSB..', 'OBBBBBB.', '.BBBBBB.', '.BB..BB.'],
        ['...BB...', '..BBBB..', '.BBSEB..', '.BBSSB..', 'QBBBBBB.', '.BBBBBB.', '.BB..BB.']
      ],
      gestures: {
        stopped: [
          '...BB...',
          '..BBBB..',
          '.BBSEB..',
          'SBBSSB..',
          'BBBBBBB.',
          '.BBBBBB.',
          '.BB..BB.'
        ]
      },
      colors: { B: NAVY, S: FACE, E: EYES, O: 0x9fe0ff, Q: 0xe8ecff }
    }
  }
}
