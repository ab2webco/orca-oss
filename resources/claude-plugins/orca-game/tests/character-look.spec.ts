import { describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { ACCESSORIES, characterCostumeOf } from '../hooks/character-look'
import { flatMemberLinesOf } from '../hooks/flat-view'
import { hudGridOf, type HudMember } from '../hooks/fleet-hud'
import { tileGridOf } from '../hooks/fleet-tiles'
import { placedPartyOf } from '../hooks/hd-party'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import type { SceneDefinition } from '../hooks/scenes/index'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'
import { ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES } from '../../../../src/shared/orchestrator-game-scene-characters'
import {
  byScenePhase,
  sceneFile
} from '../../../../src/shared/__fixtures__/orchestrator-game-scene'

// Why: the built-in Quest dresses its own roster; these tests need its costumes undressed.
const { characters: _quest, ...PLAIN } = QUEST_SCENE

const princess = {
  rows: ['...YYYY...', '..YYYYYY..', '..PSSSSP..', '..SESSES..', '.PPPPPPPP.', '..PPPPPP..'],
  legs: ['..P....P..', '.P......P.'],
  colors: { Y: 0xfcd800, P: 0xf878f8, S: 0xfca044, E: 0x000000 }
}

const SCENE: SceneDefinition = {
  ...PLAIN,
  roster: ['Arthur', { en: 'Merlin', es: 'Merlín' }, 'Morgana', 'Elaine'],
  characters: [
    {
      name: { en: 'Merlin', es: 'Merlín' },
      variant: { colors: { O: 0x5f8fd7 }, accessory: 'crown' }
    },
    { name: 'Morgana', variant: { accessory: 'horns', accessoryColor: 0x7a2a8a } },
    { name: 'Elaine', costumes: byScenePhase(princess) as SceneDefinition['costumes'] }
  ]
}

const NAMES = ['Arthur · ORCA-1 a', 'Merlin · ORCA-2 b', 'Morgana · ORCA-3 c', 'Elaine · ORCA-4 d']

describe('characterCostumeOf', () => {
  it('draws a plain-name member, or a scene without characters, in the phase costume as before', () => {
    expect(characterCostumeOf(SCENE, NAMES[0]!, 'build')).toBe(QUEST_SCENE.costumes.build)
    expect(characterCostumeOf(PLAIN, NAMES[1]!, 'build')).toBe(QUEST_SCENE.costumes.build)
    expect(characterCostumeOf(SCENE, 'ORCA-9 no name', 'pr')).toBe(QUEST_SCENE.costumes.pr)
  })

  it('lays a variant palette over every phase costume and adds its accessory on empty cells', () => {
    for (const phase of ['working', 'docs', 'build', 'verify', 'pr', 'handoff'] as const) {
      const base = QUEST_SCENE.costumes[phase]
      const merlin = characterCostumeOf(SCENE, NAMES[1]!, phase)
      expect(merlin.colors.O).toBe(0x5f8fd7)
      expect(merlin.legs).toEqual(base.legs)
      base.rows.forEach((row, y) =>
        [...row].forEach((glyph, x) => {
          if (glyph !== '.') {
            expect(merlin.rows[y]?.[x]).toBe(glyph)
          }
        })
      )
      expect(merlin.rows.join('')).not.toBe(base.rows.join(''))
    }
    const morgana = characterCostumeOf(SCENE, NAMES[2]!, 'working')
    const added = [...morgana.rows.join('').replaceAll('.', '')].find(
      (one) => !(one in QUEST_SCENE.costumes.working.colors)
    )
    expect(added === undefined ? undefined : morgana.colors[added]).toBe(0x7a2a8a)
  })

  it('draws a character with costumes of its own in them, and finds it by any language or number', () => {
    expect(characterCostumeOf(SCENE, NAMES[3]!, 'pr').rows).toEqual(princess.rows)
    const merlin = characterCostumeOf(SCENE, NAMES[1]!, 'docs')
    expect(characterCostumeOf(SCENE, 'Merlín · ORCA-5 e', 'docs')).toBe(merlin)
    expect(characterCostumeOf(SCENE, 'Merlin 2 · ORCA-6 f', 'docs')).toBe(merlin)
  })

  it('draws every accessory Orca accepts', () => {
    expect([...ACCESSORIES]).toEqual([...ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES])
    const looks = ACCESSORIES.map((accessory) => {
      const scene = { ...QUEST_SCENE, characters: [{ name: 'A', variant: { accessory } }] }
      return characterCostumeOf(scene, 'A', 'working').rows.join('/')
    })
    expect(new Set(looks).size).toBe(ACCESSORIES.length)
  })
})

describe('scene characters on the wire', () => {
  it('reads character entries as Orca parses the file, and as Orca serves the definition', () => {
    const text = JSON.stringify(
      sceneFile({
        roster: [
          'Mario',
          { name: 'Luigi', variant: { colors: { H: '#2e7d4f' }, accessory: 'cape' } },
          { name: { en: 'Peach', es: 'Melocotón' }, costumes: byScenePhase(princess) }
        ]
      })
    )
    const orca = parseOrchestratorGameScene(text, 'file:a.json')
    const served = orca.ok ? JSON.parse(JSON.stringify(orca.definition)) : undefined
    expect(orca.ok && orca.definition.characters).toHaveLength(2)
    expect(sceneDefinitionOf(JSON.parse(text), 'file:a.json')).toEqual(
      orca.ok ? orca.definition : undefined
    )
    expect(sceneDefinitionOf(served, 'file:a.json')).toEqual(orca.ok ? orca.definition : undefined)
  })

  it('leaves out a character it cannot draw and keeps the scene and its names', () => {
    const scene = sceneDefinitionOf(
      {
        ...JSON.parse(JSON.stringify(QUEST_SCENE)),
        roster: ['Arthur', 'Merlin'],
        characters: [{ name: 'Merlin', variant: { accessory: 'jetpack' } }]
      },
      'file:a.json'
    )
    expect(scene?.roster).toEqual(['Arthur', 'Merlin'])
    expect(scene?.characters).toBeUndefined()
  })
})

const hudMember = (name: string): HudMember => ({
  name,
  phase: 'build',
  state: 'working',
  says: ''
})
const SLOT = 22
const PARTY_AT = 14

// Every pixel of each party slot's sprite, so two members drawn alike compare equal.
const slotsOf = (scene: SceneDefinition): string[] => {
  const columns = PARTY_AT + SLOT * NAMES.length + 1
  const grid = hudGridOf(scene, NAMES.map(hudMember), columns, 0)
  return NAMES.map((_, slot) =>
    grid
      .filter((_, at) => {
        const x = at % columns
        return x >= PARTY_AT + slot * SLOT && x < PARTY_AT + slot * SLOT + 10
      })
      .map((cell) => `${cell[1]}:${cell[2]}`)
      .join(',')
  )
}

describe('members drawn as their characters', () => {
  it('draws each member in one phase as its character on the band, a plain name as before', () => {
    const drawn = slotsOf(SCENE)
    const plain = slotsOf(PLAIN)
    expect(drawn[0]).toBe(plain[0])
    expect(drawn.slice(1).filter((slot, i) => slot === plain[i + 1])).toEqual([])
  })

  it('draws each Panel tile and hd party member in its own character', () => {
    const tiles = NAMES.map((name) =>
      JSON.stringify(tileGridOf(SCENE, 'build', 'working', 0, 'none', name))
    )
    expect(new Set(tiles).size).toBe(4)
    const party = placedPartyOf({
      scene: SCENE,
      party: NAMES.map((name, i) => ({ key: `k${i}`, name, phase: 'build', state: 'working' })),
      leavers: [],
      marches: new Map(),
      columns: 200,
      ground: 20,
      tick: 0,
      walk: 150,
      pitch: 11,
      shown: 4,
      isResting: false,
      fireRight: 0,
      spriteWidth: 12
    })
    expect(new Set(party.map((one) => JSON.stringify(one.sprite.rows))).size).toBe(4)
  })

  it('marks each character in the flat view with its own color, and a plain name with none', () => {
    const agent = (displayName: string, paneKey: string): GameAgent => ({
      paneKey,
      displayName,
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: false
    })
    const state: GameState = {
      config: {},
      warnings: [],
      extensions: { scenes: [] },
      links: [],
      activity: null,
      worktree: null,
      agents: NAMES.map((name, i) => agent(name, `p${i}`)),
      review: null,
      workItem: null,
      role: 'lead'
    }
    const lines = flatMemberLinesOf({ state, scene: SCENE, columns: 80, maxMembers: 4 })
    const looks = lines.map((line) => line.parts.find((part) => part.key === 'look')?.color)
    expect(looks[0]).toBeUndefined()
    expect(new Set(looks.slice(1)).size).toBe(3)
    expect(looks[1]).toBe('#5f8fd7')
  })
})
