import type { SceneDefinition } from './scene-definition'

const CLAUDE = 0xd77757
const EYES = 0x1a1a1a
const SKIN = { O: CLAUDE, E: EYES }

// Squire, Sage, Blacksmith, Knight, Herald and King walking a parallax landscape.
export const QUEST_SCENE: SceneDefinition = {
  id: 'quest',
  looks: {
    working: {
      skyTop: 0x4a7fc1,
      skyBottom: 0xa9d4f5,
      sun: 0xffe08a,
      isNight: false,
      far: 0x6d7f99,
      snow: 0xf2f5fa,
      near: 0x4f8a55,
      ground: 0x6b4f35,
      plant: 0x2f6b3a,
      plantKind: 'tree',
      cloud: 0xf4f7fb
    },
    docs: {
      skyTop: 0x2b3a67,
      skyBottom: 0xf6a77a,
      sun: 0xffc977,
      isNight: false,
      far: 0x5b4a7a,
      snow: 0xe9dcf2,
      near: 0x3f5f4a,
      ground: 0x4a3a2c,
      plant: 0x2c4a36,
      plantKind: 'tree',
      cloud: 0xf7c9b0
    },
    build: {
      skyTop: 0x3b8fd6,
      skyBottom: 0xbfe6ff,
      sun: 0xfff1a8,
      isNight: false,
      far: 0x6b7f99,
      snow: 0xffffff,
      near: 0x3f8f4a,
      ground: 0x7a5a3a,
      plant: 0x1f5e2c,
      plantKind: 'tree',
      cloud: 0xffffff
    },
    verify: {
      skyTop: 0x6fb3f2,
      skyBottom: 0xffe0a3,
      sun: 0xfff3c4,
      isNight: false,
      far: 0xc46a3a,
      snow: 0xe8955e,
      near: 0xd9a35f,
      ground: 0xe0b36a,
      plant: 0x3d7a3a,
      plantKind: 'cactus',
      cloud: 0xfff7e6
    },
    pr: {
      skyTop: 0x3b1e5f,
      skyBottom: 0xff7a59,
      sun: 0xff4f3a,
      isNight: false,
      far: 0x2d1f3d,
      snow: 0x7a4a6a,
      near: 0x4a2f3f,
      ground: 0x2a1c26,
      plant: 0x1c1420,
      plantKind: 'tree',
      cloud: 0xff9f86
    },
    handoff: {
      skyTop: 0x0b1030,
      skyBottom: 0x253a6b,
      sun: 0xe8ecff,
      isNight: true,
      far: 0x1c2540,
      snow: 0x9aa8d0,
      near: 0x182a2a,
      ground: 0x10201c,
      plant: 0x0c1814,
      plantKind: 'tree',
      cloud: 0x34406b
    }
  },
  costumes: {
    working: {
      rows: ['..........', '..HHHHH...', '.HHHHHHH..', '.OEOOOEO..', 'OBBBBBBBO.', '.BBBBBBB..'],
      legs: ['.O.O.O.O..', 'O.O.O.O.O.'],
      colors: { ...SKIN, H: 0x3f6e46, B: 0x5f7f3a }
    },
    docs: {
      rows: ['....P.....', '...PYP...T', '.PPPPPPP.Y', '.OEOOOEO.T', 'ORWWWWWROT', '.RRWWWRR.T'],
      legs: ['.RRRRRRR.T', 'RRRRRRRRRT'],
      colors: { ...SKIN, P: 0x5b3fa8, Y: 0xffd84a, R: 0x3e2a78, W: 0xf2f2f2, T: 0x7a5230 }
    },
    build: {
      rows: ['..........', '..DDDDD...', '.DDDDDDD..', '.OEOOOEO.G', 'OAAAAAAAOT', '.AAAAAAA.T'],
      legs: ['.O.O.O.O..', 'O.O.O.O.O.'],
      colors: { ...SKIN, D: 0x4a2f1c, A: 0x8a5a2b, G: 0x9aa3ab, T: 0x6b4a2b }
    },
    verify: {
      rows: ['....M.....', '..SSSSS...', '.SSSSSSS..', '.SKSSSKS..', 'OTTTXTTTO.', '.TTTXTTT..'],
      legs: ['.S.S.S.S..', 'S.S.S.S.S.'],
      colors: { ...SKIN, M: 0xd83a2e, S: 0xc3ccd6, K: 0x1a1a1a, T: 0x2c5aa0, X: 0xf4f4f4 }
    },
    pr: {
      rows: ['......F...', '..CCCCC...', '.CCCCCCC..', '.OEOOOEO.P', 'OGGGGGGGOP', '.GGGGGGG..'],
      legs: ['.O.O.O.O..', 'O.O.O.O.O.'],
      colors: { ...SKIN, F: 0xffffff, C: 0x2e7d4f, G: 0xd4a017, P: 0xf1e2b8 }
    },
    handoff: {
      rows: ['.Y.Y.Y.Y..', '.YYYYYYY..', '.YJYYYJY..', '.OEOOOEO..', 'RNNNNNNNR.', '.RRRRRRR..'],
      legs: ['.O.O.O.O..', 'O.O.O.O.O.'],
      colors: { ...SKIN, Y: 0xf5c518, J: 0xd8283a, R: 0xa3202a, N: 0xf4f1ea }
    }
  },
  cards: {
    working: {
      icon: '◆',
      name: { en: 'Squire', es: 'Escudero' },
      color: '#7fa86a'
    },
    docs: {
      icon: '✦',
      name: { en: 'Sage', es: 'Sabio' },
      color: '#9a7fe0'
    },
    build: {
      icon: '⚒',
      name: { en: 'Blacksmith', es: 'Herrero' },
      color: '#d98a3d'
    },
    verify: {
      icon: '⚔',
      name: { en: 'Knight', es: 'Caballero' },
      color: '#5b8fd6'
    },
    pr: {
      icon: '✉',
      name: { en: 'Herald', es: 'Heraldo' },
      color: '#3fae6f'
    },
    handoff: {
      icon: '♛',
      name: { en: 'King', es: 'Rey' },
      color: '#e0b020'
    }
  },
  teller: {
    icon: '❝',
    name: { en: 'Storyteller', es: 'Narrador' },
    color: '#8f9bb3'
  },
  band: { gold: '#c9a24a', ink: '#1a1f33', panel: '#2b3150', parchment: '#f1e2b8' }
}
