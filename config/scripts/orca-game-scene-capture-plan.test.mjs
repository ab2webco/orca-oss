import { describe, expect, it } from 'vitest'
import { captureOptionsOf, scenePhasesOf, sceneShotsOf } from './orca-game-scene-capture-plan.mjs'

const ALL = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

describe('orca-game scene capture plan', () => {
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
})
