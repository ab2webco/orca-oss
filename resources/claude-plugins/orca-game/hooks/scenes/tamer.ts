import { sceneCharacter, type SceneDefinition } from './scene-definition'

const EYES = 0x1a1a1a
const FACE = 0xf0c9a0

// A shiny: the tamer's cap and every partner's body in one color of its own.
const shiny = (
  name: string,
  color: number,
  ...accessory: [Parameters<typeof sceneCharacter>[2], number]
) => sceneCharacter(name, { C: color, G: color, R: color, T: color, A: color }, ...accessory)

const CHARACTERS = [
  shiny('Mochi', 0xf8b8d0, 'bow', 0xe0405a),
  shiny('Bramble', 0x7a5a3a, 'horns', 0xe8e0c8),
  shiny('Sprout', 0x9ae07a, 'antenna', 0x5fbf6a),
  shiny('Pebble', 0xa0a0a8, 'crown', 0xffd84a),
  shiny('Fern', 0x3f9f5a, 'feather', 0x2f8a3a),
  shiny('Clover', 0x6ad08a, 'halo', 0xfff3a0),
  shiny('Thistle', 0xa06ad0, 'horns', 0xb07ae0),
  shiny('Puddle', 0x5fa8e8, 'bow', 0x6aa8f0),
  shiny('Nibbles', 0xe8c890, 'antenna', 0x8a6a4a),
  shiny('Juniper', 0x4a7aa0, 'cape', 0x6a8ad0),
  shiny('Biscuit', 0xd89a5a, 'cape', 0xb05a2a)
]

// Beast Tamer by Jucer Orozco (koombea/cineco-orchestrator PR #32): a tamer and five original
// creatures across flower meadows, and a wild glitch bug on red CI.
export const TAMER_SCENE: SceneDefinition = {
  id: 'tamer',
  looks: {
    working: {
      skyTop: 0x4aa0e8,
      skyBottom: 0xc0ecff,
      sun: 0xfff4a0,
      isNight: false,
      far: 0x7ac08a,
      snow: 0xffffff,
      near: 0x5fb85a,
      ground: 0x8a6a3a,
      plant: 0xff7aa0,
      plantKind: 'flower',
      cloud: 0xffffff,
      scenery: 'meadow'
    },
    docs: {
      skyTop: 0x5ab0e0,
      skyBottom: 0xd8f8d0,
      sun: 0xfff8c0,
      isNight: false,
      far: 0x6ab87a,
      snow: 0xffffff,
      near: 0x4aa84a,
      ground: 0x7a5a30,
      plant: 0xffe04a,
      plantKind: 'flower',
      cloud: 0xf8fff8,
      scenery: 'meadow'
    },
    build: {
      skyTop: 0xe0703a,
      skyBottom: 0xffd08a,
      sun: 0xfff0a0,
      isNight: false,
      far: 0xb06a3a,
      snow: 0xffe0b0,
      near: 0x8a8a3a,
      ground: 0x7a4a2a,
      plant: 0xff5a3a,
      plantKind: 'flower',
      cloud: 0xffe8c0,
      scenery: 'meadow'
    },
    verify: {
      skyTop: 0x3a4a8a,
      skyBottom: 0xa0b8e0,
      sun: 0xfff060,
      isNight: false,
      far: 0x5a6a9a,
      snow: 0xf0f0ff,
      near: 0x4a7a6a,
      ground: 0x5a5a4a,
      plant: 0xf2e04a,
      plantKind: 'flower',
      cloud: 0xd0d8f0,
      scenery: 'meadow'
    },
    pr: {
      skyTop: 0x2a7ac0,
      skyBottom: 0x9ae0f0,
      sun: 0xffffff,
      isNight: false,
      far: 0x3a8aa0,
      snow: 0xe0ffff,
      near: 0x3a9a8a,
      ground: 0x6a6a5a,
      plant: 0x5ac8ff,
      plantKind: 'flower',
      cloud: 0xf0ffff,
      scenery: 'meadow'
    },
    handoff: {
      skyTop: 0x1a1450,
      skyBottom: 0x6a4aa0,
      sun: 0xfff0c0,
      isNight: true,
      far: 0x2a2460,
      snow: 0xd8c8ff,
      near: 0x2a3a4a,
      ground: 0x1a1a24,
      plant: 0xf5e6a8,
      plantKind: 'flower',
      cloud: 0x4a3a80,
      scenery: 'meadow'
    }
  },
  // Z is each creature's evolution color in PR #32; kept so the art stays as drawn there.
  costumes: {
    working: {
      rows: ['..........', '..CCCCC...', '.CCCCCCCC.', '..SQSSQS..', 'BJJJJJJJB.', '.JJJJJJJ..'],
      legs: ['.D.D.D.D..', 'D.D.D.D.D.'],
      colors: { C: 0x3a7bd6, S: FACE, Q: EYES, J: 0xe0a13a, B: 0x5a3a20, D: 0x2f4a7a }
    },
    docs: {
      rows: ['....L.....', '...LL.....', '..GGGGG...', '.GWKGWKG..', '.GGGGGGG..', '..GGGGG...'],
      legs: ['..G...G...', '.G.....G..'],
      colors: { G: 0x5fbf6a, L: 0x2f8a3a, W: 0xffffff, K: EYES, Z: 0x9fe07a }
    },
    build: {
      rows: ['.R.....R..', '.RR...RR..', '.RRRRRRR.F', '.RWKRWKR.F', '..RRRRRRRF', '..RRRRRR..'],
      legs: ['..R.R.R...', '.R.R.R.R..'],
      colors: { R: 0xe0663a, F: 0xffc14a, W: 0xffffff, K: EYES, Z: 0xffd84a }
    },
    verify: {
      rows: ['....V.....', '...VT.....', '..TTTTT...', '.TWKTWKT..', '.TTTTTTT.V', '..TTTTT...'],
      legs: ['..T...T...', '.T.....T..'],
      colors: { V: 0xf2d35a, T: 0x7fd3c8, W: 0xffffff, K: EYES, Z: 0xf2d35a }
    },
    pr: {
      rows: ['..........', '....A.....', '..AAAAA...', '.AWKAAAAA.', '.AAAAAAA.A', '..AAAAA..A'],
      legs: ['..A...A...', '.A.....A..'],
      colors: { A: 0x3a8fd6, W: 0xffffff, K: EYES, Z: 0x9fe0ff }
    },
    handoff: {
      rows: ['....S.....', '...SSS....', 'W.SSSSS.W.', 'WWSWKSSWW.', '.WSSSSSW..', '..SSSSS...'],
      legs: ['...S.S....', '..S...S...'],
      colors: { S: 0xf5e6a8, W: 0xffffff, K: EYES, Z: 0xffd84a }
    }
  },
  cards: {
    working: {
      icon: '◓',
      name: { en: 'Tamer', es: 'Domadora' },
      color: '#3a7bd6'
    },
    docs: {
      icon: '❦',
      name: { en: 'Leafling', es: 'Hojín' },
      color: '#5fbf6a'
    },
    build: {
      icon: '♨',
      name: { en: 'Emberpup', es: 'Brasita' },
      color: '#e0663a'
    },
    verify: {
      icon: 'ϟ',
      name: { en: 'Voltbit', es: 'Voltín' },
      color: '#7fd3c8'
    },
    pr: {
      icon: '≈',
      name: { en: 'Aquafin', es: 'Aletín' },
      color: '#9fe0ff'
    },
    handoff: {
      icon: '✧',
      name: { en: 'Starling', es: 'Estrellín' },
      color: '#f5e6a8'
    }
  },
  teller: {
    icon: '❝',
    name: { en: 'Professor', es: 'Profesor' },
    color: '#e0a13a'
  },
  band: { gold: '#f2d35a', ink: '#2f6fb0', panel: '#2f6fb0', parchment: '#ffffff' },
  foe: {
    rows: ['.A.....A..', '..A...A...', '..MMMMM...', '.MRMMMRM..', 'MMXMXMXMM.', '.M.M.M.M..'],
    legs: ['M.M...M.M.', '.M.M.M.M..'],
    colors: { A: 0x8a8f99, M: 0x7a3fb0, R: 0xff3b3b, X: 0x2a1c40 }
  },
  finale: { en: '◓ CAUGHT!', es: '◓ ¡ATRAPADO!' },
  // Jev's advisor: the professor in a lab coat, who knows every creature's level.
  // Orca's built-in roster for the scene; its first name wears the phase costumes as they are.
  roster: ['Pip', ...CHARACTERS.map((one) => one.name)],
  characters: CHARACTERS,
  cast: {
    advisor: {
      name: { en: 'Professor', es: 'Profesor' },
      frames: [
        ['..HHHH..', '.HSSSS..', '.SESSS..', '..SSS...', '.WWWWWW.', 'SWWBWWWS', '..K..K..']
      ],
      gestures: {
        stopped: [
          '..HHHH..',
          '.HSSSS..',
          '.SESSS..',
          'S.SSS...',
          'WWWWWWW.',
          '.WWBWWWS',
          '..K..K..'
        ]
      },
      colors: { H: 0x8a8a8a, S: FACE, E: EYES, W: 0xf4f4f4, B: 0x3a7bd6, K: 0x5a3a20 }
    }
  }
}
