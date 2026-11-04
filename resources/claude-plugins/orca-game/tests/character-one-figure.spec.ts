import { describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { characterColorOf, characterCostumeOf } from '../hooks/character-look'
import { hudGridOf } from '../hooks/fleet-hud'
import { heroNameOf, shortMemberNameOf } from '../hooks/member-character'
import { memberOf } from '../hooks/party'
import { sceneGridOf } from '../hooks/scene'
import { hdSceneGridOf } from '../hooks/scene-hd'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { SCENES, type SceneDefinition, type ScenePhase } from '../hooks/scenes/index'

// Why neutral names: this public repo never carries a franchise's characters, even in a fixture.
const { characters: _dressed, ...BARE } = QUEST_SCENE
const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fen', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu']
const PLAIN: SceneDefinition = { ...BARE, roster: NAMES }
const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

const figureOf = (scene: SceneDefinition, name: string, phase: ScenePhase): string => {
  const { rows, legs, colors } = characterCostumeOf(scene, name, phase)
  return JSON.stringify({ rows, legs, colors })
}

describe('one member, one figure', () => {
  it.each(NAMES)('draws %s the same in every phase, not the phase it is in', (name) => {
    const looks = PHASES.map((phase) => figureOf(PLAIN, `${name} · ORCA-1 title`, phase))
    expect(new Set(looks).size).toBe(1)
  })

  it('gives a plain roster a figure and a color per name, with no help from the scene file', () => {
    expect(new Set(NAMES.map((name) => figureOf(PLAIN, name, 'working'))).size).toBe(NAMES.length)
    expect(new Set(NAMES.map((name) => characterColorOf(PLAIN, name))).size).toBeGreaterThan(7)
  })

  it('gives a scene as a host receives it the same figures as the lead draws', () => {
    const carried = sceneDefinitionOf(JSON.parse(JSON.stringify(PLAIN)), 'file:a.json')
    expect(carried).toBeDefined()
    for (const name of NAMES) {
      expect(figureOf(carried!, name, 'pr')).toBe(figureOf(PLAIN, name, 'pr'))
    }
  })

  it('keeps a language variant of a plain name on one figure', () => {
    const scene: SceneDefinition = {
      ...BARE,
      roster: [{ en: 'Ada', es: 'Adela' }, 'Bo']
    }
    expect(figureOf(scene, 'Adela · ORCA-1', 'docs')).toBe(figureOf(scene, 'Ada · ORCA-1', 'pr'))
  })

  it('tells a numbered member from its plain namesake, and a ticket-only member by its ticket', () => {
    expect(figureOf(PLAIN, 'Ada 2 · ORCA-2', 'pr')).not.toBe(figureOf(PLAIN, 'Ada · ORCA-1', 'pr'))
    expect(figureOf(PLAIN, 'ORCA-9 a title', 'pr')).toBe(figureOf(PLAIN, 'ORCA-9 renamed', 'docs'))
  })

  it.each(Object.values(SCENES))('draws a dressed character of $id in one figure', (scene) => {
    for (const entry of scene.characters ?? []) {
      if (entry.variant !== undefined) {
        const name = typeof entry.name === 'string' ? entry.name : entry.name.en
        expect(new Set(PHASES.map((phase) => figureOf(scene, name, phase))).size).toBe(1)
      }
    }
  })

  it.each(Object.values(SCENES))('shows the palette a $id character names', (scene) => {
    for (const entry of scene.characters ?? []) {
      const glyphs = Object.keys(entry.variant?.colors ?? {})
      if (glyphs.length > 0) {
        const name = typeof entry.name === 'string' ? entry.name : entry.name.en
        const drawn = characterCostumeOf(scene, name, 'working').rows.join('')
        expect(glyphs.some((glyph) => drawn.includes(glyph))).toBe(true)
      }
    }
  })

  it('draws the hero as its owner in the classic and hd scenes, whatever the phase', () => {
    const classic = (phase: ScenePhase, hero?: string) =>
      JSON.stringify(
        sceneGridOf(PLAIN, phase, 60, 0, '', -Infinity, undefined, true, undefined, undefined, hero)
      )
    expect(classic('build', 'Ada · ORCA-1')).not.toBe(classic('build'))
    const hd = (hero?: string) =>
      JSON.stringify(
        hdSceneGridOf({
          scene: PLAIN,
          columns: 80,
          rows: 9,
          tick: 0,
          caption: '',
          since: 0,
          hero
        })
      )
    expect(hd('Ada · ORCA-1')).not.toBe(hd())
    const hud = (phase: ScenePhase) =>
      JSON.stringify(hudGridOf(PLAIN, [], 60, 0, { hero: `Ada · ORCA-1 ${phase}` }))
    expect(hud('build')).toBe(hud('pr'))
    expect(hud('build')).not.toBe(JSON.stringify(hudGridOf(PLAIN, [], 60, 0)))
  })
})

describe('the name a member goes by', () => {
  it('reads the character of a launched name that has no title', () => {
    expect(shortMemberNameOf('Ada · ORCA-1034')).toBe('Ada')
    expect(shortMemberNameOf('Ada 2 · ORCA-1034 a title')).toBe('Ada 2')
    expect(shortMemberNameOf('ORCA-1034')).toBe('ORCA-1034')
  })

  const lead: GameAgent = {
    paneKey: 'lead',
    displayName: null as unknown as string,
    agentType: 'claude',
    state: 'working',
    toolName: 'Edit',
    isLeader: true
  }
  const state = (patch: Partial<GameState>): GameState => ({
    config: {},
    warnings: [],
    extensions: { scenes: [] },
    links: [],
    activity: null,
    worktree: null,
    agents: [],
    review: null,
    workItem: null,
    role: 'lead',
    ...patch
  })

  it('names the lead by its title on its card, as its hero does', () => {
    const labelled = state({
      agents: [lead],
      lead: { label: 'Skipper' } as GameState['lead']
    })
    expect(memberOf(lead, labelled, false).name).toBe('Skipper')
  })

  it('makes a member pane its hero by the worktree name, and a lead by its title', () => {
    expect(heroNameOf(true, 'Ada · ORCA-1034', 'Skipper')).toBe('Ada · ORCA-1034')
    expect(heroNameOf(false, 'Ada · ORCA-1034', 'Skipper')).toBe('Skipper')
    expect(heroNameOf(true, 'scratch', undefined)).toBeUndefined()
  })
})
