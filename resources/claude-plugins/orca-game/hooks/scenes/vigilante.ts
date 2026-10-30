import { sceneCharacter, type SceneDefinition } from './scene-definition'

const EYES = 0x1a1a1a
const WHITE = 0xf4f4f4
const COWL = 0x4b5580
const CAPE = 0x3c4466
const RIM = 0x9aa6c9
const INK = 0x06070c
const SUIT = 0x5d6475
const BELT = 0xd8b23c
const HERO_SKIN = 0xe2b48c

// A hero's skin, and the cape, hat or hair each phase's costume wears.
const hero = (
  name: string,
  skin: number,
  gear: number,
  ...accessory: [Parameters<typeof sceneCharacter>[2], number]
) => sceneCharacter(name, { S: skin, C: gear, F: gear, H: gear, B: gear }, ...accessory)

const CHARACTERS = [
  hero('Raven', 0xf6d5b8, 0x2a2a3a, 'feather', 0x8a8ab0),
  hero('Lynx', 0xc68e5e, 0x8a6a2a, 'horns', 0xc8a050),
  hero('Vesper', 0x9a6440, 0x6a2a6a, 'bow', 0xd83a8a),
  hero('Specter', 0xe8e8f0, 0x4a5a6a, 'halo', 0xc8f0ff),
  hero('Onyx', 0x6b4428, 0x1a1a1a, 'cape', 0x9a9aaa),
  hero('Talon', 0xd8a070, 0x7a3a1a, 'feather', 0xc04a2a),
  hero('Nova', 0xfadcc0, 0x2a4a9a, 'antenna', 0xfff06a),
  hero('Shade', 0x8a5a38, 0x2a3a2a, 'cape', 0x5fa07a),
  hero('Ember', 0xf0c8a0, 0xb03a1a, 'horns', 0xff7a2a),
  hero('Falcon', 0xb57a50, 0x5a4a2a, 'crown', 0xd8b040),
  hero('Cipher', 0xa87048, 0x2a6a5a, 'antenna', 0x5fe0a0)
]

// Night Watch by Jucer Orozco (koombea/cineco-orchestrator PR #32): a caped vigilante over a
// night skyline with a signal in the sky, and a masked rogue on red CI.
export const VIGILANTE_SCENE: SceneDefinition = {
  id: 'vigilante',
  looks: {
    working: {
      skyTop: 0x0a0e1f,
      skyBottom: 0x2a2f4a,
      sun: 0xf3e9a8,
      isNight: true,
      far: 0x1b2033,
      snow: 0xf2c94c,
      near: 0x121624,
      ground: 0x0d0f17,
      plant: 0x3a4058,
      plantKind: 'antenna',
      cloud: 0x2c3350,
      scenery: 'skyline',
      isSignal: true
    },
    docs: {
      skyTop: 0x0d1424,
      skyBottom: 0x3a3550,
      sun: 0xd8d2b0,
      isNight: true,
      far: 0x221d30,
      snow: 0xe8b04a,
      near: 0x16131f,
      ground: 0x0f0d16,
      plant: 0x3a3048,
      plantKind: 'antenna',
      cloud: 0x3a3352,
      scenery: 'skyline'
    },
    build: {
      skyTop: 0x0b1626,
      skyBottom: 0x1f3a4a,
      sun: 0x9fe0ff,
      isNight: true,
      far: 0x16263a,
      snow: 0x56c8d8,
      near: 0x10202c,
      ground: 0x0a141c,
      plant: 0x2a4a5a,
      plantKind: 'antenna',
      cloud: 0x22384a,
      scenery: 'skyline'
    },
    verify: {
      skyTop: 0x1a0b14,
      skyBottom: 0x4a1f2a,
      sun: 0xff6a5a,
      isNight: true,
      far: 0x2a1220,
      snow: 0xff8a5a,
      near: 0x1c0d16,
      ground: 0x12080e,
      plant: 0x4a2030,
      plantKind: 'antenna',
      cloud: 0x3a1a28,
      scenery: 'skyline'
    },
    pr: {
      skyTop: 0x080a18,
      skyBottom: 0x22284a,
      sun: 0xf3e9a8,
      isNight: true,
      far: 0x161a2e,
      snow: 0xfff0a0,
      near: 0x0e1020,
      ground: 0x0a0b14,
      plant: 0x30365a,
      plantKind: 'antenna',
      cloud: 0x262c4c,
      scenery: 'skyline',
      isSignal: true
    },
    handoff: {
      skyTop: 0x1a2a4a,
      skyBottom: 0xd88a5a,
      sun: 0xffe0a0,
      isNight: false,
      far: 0x2a2f45,
      snow: 0xffd88a,
      near: 0x1c2030,
      ground: 0x14161f,
      plant: 0x3a4058,
      plantKind: 'antenna',
      cloud: 0xd8a080,
      scenery: 'skyline'
    }
  },
  costumes: {
    working: {
      rows: ['.KK...KK..', '..KKKKK...', '..KIKIK...', '.RKSSSKR..', 'RCGGYGGCR.', 'RCGGGGGCR.'],
      legs: ['.CK.K.KC..', 'C.KK.KK.C.'],
      colors: { K: COWL, C: CAPE, I: INK, R: RIM, S: HERO_SKIN, G: SUIT, Y: BELT }
    },
    docs: {
      rows: ['..........', '..FFFFF...', '.FFFFFFF..', '..SESSES..', '.TTTTTTTPP', '.TTTTTTT.P'],
      legs: ['..T.T.T...', '.T.T.T.T..'],
      colors: { F: 0x6a5a48, S: HERO_SKIN, E: EYES, T: 0xa8875a, P: 0xf1e9d2 }
    },
    build: {
      rows: ['..........', '..HHHHH...', '.HQQIQQH..', '.SSSSSSS.W', 'OVVVVVVVOW', '.VVVVVVV.W'],
      legs: ['.V.V.V.V..', 'V.V.V.V.V.'],
      colors: { H: 0x7a5636, Q: 0x56c8d8, I: INK, S: HERO_SKIN, W: 0x9aa3ab, O: BELT, V: 0x4a5a7a }
    },
    verify: {
      rows: ['..........', '..GGGGG...', '.GSSSSSG..', '.SESSSMS..', 'KKKWRWKKK.', '.KKKWKKK..'],
      legs: ['.K.K.K.K..', 'K.K.K.K.K.'],
      colors: { G: 0xc9ccd4, S: HERO_SKIN, E: EYES, M: BELT, K: 0x3d4150, W: WHITE, R: 0xc0283a }
    },
    pr: {
      rows: ['LKK...KK..', '..KKKKK...', '..KIKIK...', '.RKSSSKR..', 'RCGGYGGCR.', 'RCGGGGGCR.'],
      legs: ['.CK.K.KC..', 'C.KK.KK.C.'],
      colors: { K: COWL, C: CAPE, I: INK, R: RIM, S: HERO_SKIN, G: SUIT, Y: BELT, L: 0xd8d8d8 }
    },
    handoff: {
      rows: ['..BBBBB...', '.BBBBBBB..', '..SSSSS...', '..SESSES..', 'UUSXXXSUU.', '.UUUYUUU..'],
      legs: ['.U.U.U.U..', 'U.U.U.U.U.'],
      colors: { B: 0x45628f, S: HERO_SKIN, E: EYES, X: 0x8a6a4a, U: 0x44608f, Y: BELT }
    }
  },
  cards: {
    working: {
      icon: '◣',
      name: { en: 'Night Watch', es: 'Vigía nocturno' },
      color: '#6f7a99'
    },
    docs: {
      icon: '✎',
      name: { en: 'Detective', es: 'Detective' },
      color: '#c9a36a'
    },
    build: {
      icon: '⚙',
      name: { en: 'Gadgeteer', es: 'Inventor' },
      color: '#56c8d8'
    },
    verify: {
      icon: '⌘',
      name: { en: 'Mentor', es: 'Mentor' },
      color: '#c9ccd4'
    },
    pr: {
      icon: '↗',
      name: {
        en: 'Rooftop Run',
        es: 'Carrera en azoteas'
      },
      color: '#d8b23c'
    },
    handoff: {
      icon: '★',
      name: { en: 'Commissioner', es: 'Comisionado' },
      color: '#5b8fd6'
    }
  },
  teller: {
    icon: '❝',
    name: { en: 'Narrator', es: 'Narrador' },
    color: '#8f9bb3'
  },
  band: { gold: '#8a93a8', ink: '#05070f', panel: '#1a1d2e', parchment: '#e6e8ee' },
  foe: {
    rows: ['..........', '..RRRRR...', '.RRRRRRR..', '.MWMMMWM..', 'SPPWPWPPS.', '.PWPWPWP..'],
    legs: ['.P.P.P.P..', 'P.P.P.P.P.'],
    colors: { R: 0x8a2a3a, M: 0x1a1a1a, W: WHITE, S: HERO_SKIN, P: 0x2a2a2a }
  },
  finale: { en: '◆ CASE CLOSED', es: '◆ CASO CERRADO' },
  // Jev's advisor: the commissioner, grey mustache and trench coat, by the signal.
  // Orca's built-in roster for the scene; its first name wears the phase costumes as they are.
  roster: ['Nightjar', ...CHARACTERS.map((one) => one.name)],
  characters: CHARACTERS,
  cast: {
    advisor: {
      name: { en: 'Commissioner', es: 'Comisionado' },
      frames: [
        ['..HHHH..', '.HSSSSH.', '.SGSGS..', '..MMMS..', '.CCWWCC.', 'SCCRWCCS', '.CC..CC.']
      ],
      gestures: {
        escalated: [
          '..HHHH..',
          '.HSSSSH.',
          '.SGSGS..',
          '..MMMS..',
          'SCCWWCC.',
          '.CCRWCCS',
          '.CC..CC.'
        ],
        stopped: [
          '..HHHH..',
          '.HSSSSH.',
          '.SGSGS..',
          'S.MMMS..',
          'CCCWWCC.',
          '.CCRWCCS',
          '.CC..CC.'
        ]
      },
      colors: {
        H: 0xc9ccd4,
        S: HERO_SKIN,
        G: 0x15161c,
        M: 0xc9ccd4,
        C: 0x8a6a4a,
        W: WHITE,
        R: 0xc0283a
      }
    }
  }
}
