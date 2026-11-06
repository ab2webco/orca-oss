import { describe, expect, it } from 'vitest'
import {
  arcadeShotsOf,
  captureOptionsOf,
  nativeSheetsOf,
  rosterShotsOf,
  scenePhasesOf,
  sceneShotsOf
} from './orca-game-scene-capture-plan.mjs'

const ALL = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

describe('orca-game scene capture plan', () => {
  it('sheets each style of a native art block: its stage, then every role, sheet and action', () => {
    const hero = {
      sheets: ['art/hero.png', 'art/two.png'],
      frame: { width: 32, height: 48 },
      animations: { idle: { row: 0, frames: 2 }, walk: { row: 1, frames: 4 } }
    }
    const sheets = nativeSheetsOf({
      figures: {
        layers: [{ src: 'art/sky.png' }, { src: 'art/bush.png', front: true }],
        roles: { lead: { ...hero, sheets: ['art/hero.png'] }, member: hero },
        props: { station: 'art/anvil.png' }
      }
    })
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe('native-figures')
    expect(sheets[0].layers).toEqual(['art/sky.png', 'art/bush.png'])
    expect(sheets[0].props).toEqual(['art/anvil.png'])
    expect(sheets[0].strips.map((one) => `${one.role} ${one.sheet} ${one.action}`)).toEqual([
      'lead art/hero.png idle',
      'lead art/hero.png walk',
      'member art/hero.png idle',
      'member art/hero.png walk',
      'member art/two.png idle',
      'member art/two.png walk'
    ])
    expect(sheets[0].strips[1]).toMatchObject({ width: 32, height: 48, row: 1, frames: 4 })
  })

  it('has no native sheet for a scene with no art', () => {
    expect(nativeSheetsOf(undefined)).toEqual([])
  })

  it('reads --out, --scene-file and --phases', () => {
    expect(
      captureOptionsOf(['--out', '/tmp/x', '--scene-file', 'a.json', '--phases', 'pr,docs'], '/r')
    ).toMatchObject({ out: '/tmp/x', sceneFile: 'a.json', phases: ['pr', 'docs'] })
    expect(captureOptionsOf([], '/r')).toEqual({
      out: '/r/out/orca-game-captures',
      sceneFile: undefined,
      phases: undefined,
      gesture: 'approved',
      columns: [130, 60]
    })
    expect(captureOptionsOf(['--phases', 'all'], '/r').phases).toEqual(ALL)
  })

  it('reads the advisor --gesture and the --columns to draw at', () => {
    expect(
      captureOptionsOf(['--gesture', 'stopped', '--columns', '45, 80,160'], '/r')
    ).toMatchObject({ gesture: 'stopped', columns: [45, 80, 160] })
    expect(() => captureOptionsOf(['--columns', '80,wide'], '/r')).toThrow(
      'Unknown width "wide"; use whole columns such as 45,80,160'
    )
    const shots = sceneShotsOf('quest', ['build'], [45])
    expect(shots.map((shot) => shot.name)).toEqual([
      'quest-build-classic-45',
      'quest-build-hd-dawn-45',
      'quest-build-hd-day-45',
      'quest-build-hd-dusk-45',
      'quest-build-hd-night-45'
    ])
  })

  it('refuses a phase the game does not have, naming the ones it does', () => {
    expect(() => captureOptionsOf(['--phases', 'build,boss'], '/r')).toThrow(
      'Unknown phase "boss"; use all or some of working, docs, build, verify, pr, handoff'
    )
  })

  it('draws every phase of a scene file and the build phase of a built-in by default', () => {
    expect(scenePhasesOf(undefined, true)).toEqual(ALL)
    expect(scenePhasesOf(undefined, false)).toEqual(['build'])
    expect(scenePhasesOf(['pr'], true)).toEqual(['pr'])
    expect(scenePhasesOf(ALL, false)).toEqual(ALL)
  })

  it('shoots each phase in classic and in hd at dawn, noon, dusk and night, at 130 and 60 columns', () => {
    const shots = sceneShotsOf('scene-file', ['docs', 'pr'])
    expect(shots).toHaveLength(20)
    expect(shots.slice(0, 5)).toEqual([
      { name: 'scene-file-docs-classic-130', phase: 'docs', render: 'classic', columns: 130 },
      { name: 'scene-file-docs-hd-dawn-130', phase: 'docs', render: 'hd', columns: 130, hour: 6 },
      { name: 'scene-file-docs-hd-day-130', phase: 'docs', render: 'hd', columns: 130, hour: 12 },
      { name: 'scene-file-docs-hd-dusk-130', phase: 'docs', render: 'hd', columns: 130, hour: 18 },
      { name: 'scene-file-docs-hd-night-130', phase: 'docs', render: 'hd', columns: 130, hour: 23 }
    ])
    expect(new Set(shots.map((shot) => shot.name)).size).toBe(20)
    expect(shots.filter((shot) => shot.columns === 60)).toHaveLength(10)
  })

  it('shoots every roster name of a scene in its own look, phase by phase', () => {
    expect(rosterShotsOf('scene-file', ['build', 'pr'], ['Mario', 'Luigi'])).toEqual([
      { name: 'roster-scene-file-build-1', phase: 'build', member: 'Mario' },
      { name: 'roster-scene-file-build-2', phase: 'build', member: 'Luigi' },
      { name: 'roster-scene-file-pr-1', phase: 'pr', member: 'Mario' },
      { name: 'roster-scene-file-pr-2', phase: 'pr', member: 'Luigi' }
    ])
    expect(rosterShotsOf('quest', ['build'], [])).toEqual([])
  })

  it('shoots the runner in each scene by day and by night at 1440, 768, 390 and 320 px', () => {
    const shots = arcadeShotsOf(['quest', 'vigilante'])
    expect(shots).toHaveLength(20)
    expect(shots.slice(0, 4).map((shot) => shot.name)).toEqual([
      'arcade-quest-day-160',
      'arcade-quest-day-85',
      'arcade-quest-day-43',
      'arcade-quest-day-35'
    ])
    expect(shots[15]).toEqual({
      name: 'arcade-vigilante-night-35',
      scene: 'vigilante',
      hour: 23,
      columns: 35
    })
    expect(shots.slice(16).map((shot) => [shot.name, shot.screen])).toEqual([
      ['arcade-quest-over-43', 'over'],
      ['arcade-quest-paused-35', 'paused'],
      ['arcade-vigilante-over-43', 'over'],
      ['arcade-vigilante-paused-35', 'paused']
    ])
  })
})
