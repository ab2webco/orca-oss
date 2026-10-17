import { describe, expect, it } from 'vitest'

import { costumeSpriteOf, outlineOf } from '../hooks/hd-sprite'
import { mix, UPPER_HALF } from '../hooks/pixel-canvas'
import { HD_ROWS, hdRowsOf, hdSceneGridOf, type HdSceneInput } from '../hooks/scene-hd'
import {
  hdFarPixel,
  hdFrameOf,
  hdGroundPixel,
  hdPlantPixel,
  hdSkyBaseOf,
  hdSkyPixel
} from '../hooks/scene-hd-land'
import { SCENES, sceneOf } from '../hooks/scenes/index'
import { digest } from './grid-digest'

const QUEST = sceneOf('quest')
const LOOK = QUEST.looks.working

const distance = (a: number, b: number): number =>
  Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) +
  Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) +
  Math.abs((a & 255) - (b & 255))

const input = (patch: Partial<HdSceneInput> = {}): HdSceneInput => ({
  scene: QUEST,
  phase: 'build',
  columns: 130,
  rows: HD_ROWS,
  tick: 41,
  caption: 'Editing scene.ts',
  since: 0,
  ...patch
})

/** Pixel (x, y) of a packed grid: the upper or lower half of its cell. */
const pixelOf = (grid: number[][], columns: number, x: number, y: number): number =>
  grid[Math.floor(y / 2) * columns + x]?.[y % 2 === 0 ? 1 : 2] ?? -1

describe('hd geometry', () => {
  it('draws 9 rows, 10 on a tall terminal', () => {
    expect(hdRowsOf(undefined)).toBe(9)
    expect(hdRowsOf(40)).toBe(9)
    expect(hdRowsOf(60)).toBe(10)
    expect(hdRowsOf(200)).toBe(10)
  })

  it('fills rows × columns for every built-in scene and phase at any width, without throwing', () => {
    for (const scene of Object.values(SCENES)) {
      for (const phase of [undefined, 'docs', 'build', 'verify', 'pr', 'handoff'] as const) {
        for (const columns of [1, 2, 7, 13, 20, 60, 130]) {
          for (const rows of [9, 10]) {
            const grid = hdSceneGridOf(input({ scene, phase, columns, rows }))
            expect(grid).toHaveLength(rows * columns)
          }
        }
      }
    }
  })

  it('draws every built-in scene as itself', () => {
    const shown = Object.values(SCENES).map((scene) => digest(hdSceneGridOf(input({ scene }))))
    expect(new Set(shown).size).toBe(Object.keys(SCENES).length)
  })
})

describe('hd layers', () => {
  const frame = hdFrameOf({ look: LOOK, width: 130, rows: 9, tick: 0, scroll: 0 })

  it('grades the sky from its top colour to its bottom one', () => {
    const top = hdSkyBaseOf(frame, 4, 0)
    const low = hdSkyBaseOf(frame, 4, frame.ground - 1)
    expect(distance(top, LOOK.skyTop)).toBeLessThan(distance(low, LOOK.skyTop))
    expect(distance(low, LOOK.skyBottom)).toBeLessThan(distance(top, LOOK.skyBottom))
  })

  it('puts a sun disc with a glow around it', () => {
    const sunY = Math.round(frame.sunY)
    expect(hdSkyBaseOf(frame, frame.sunX, sunY)).toBe(LOOK.sun)
    const glow = hdSkyBaseOf(frame, frame.sunX + Math.ceil(frame.sunR * 1.6), sunY)
    const plain = mix(LOOK.skyTop, LOOK.skyBottom, sunY / (frame.ground - 1))
    expect(distance(glow, LOOK.sun)).toBeLessThan(distance(plain, LOOK.sun))
  })

  it('drifts two cloud layers at different heights', () => {
    const wide = hdFrameOf({ look: LOOK, width: 400, rows: 9, tick: 0, scroll: 0 })
    const ys = new Set<number>()
    for (let x = 0; x < 380; x += 1) {
      for (let y = 0; y < wide.ground; y += 1) {
        const color = hdSkyPixel(wide, x, y)
        if (color !== hdSkyBaseOf(wide, x, y) && distance(color, LOOK.cloud) < 60) {
          ys.add(y)
        }
      }
    }
    const split = wide.pixels * 0.22
    expect([...ys].some((y) => y < split)).toBe(true)
    expect([...ys].some((y) => y >= split)).toBe(true)
  })

  it('fogs the far scenery toward the sky', () => {
    let checked = 0
    for (let x = 0; x < 130; x += 1) {
      for (let y = 0; y < frame.ground; y += 1) {
        const far = hdFarPixel(frame, x, y)
        if (far === undefined || distance(far, LOOK.snow) < 40) {
          continue
        }
        const sky = mix(LOOK.skyTop, LOOK.skyBottom, y / (frame.ground - 1))
        expect(distance(far, sky)).toBeLessThan(distance(LOOK.far, sky))
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('grows near props to the characters’ size', () => {
    const tall = new Set<number>()
    for (let x = 0; x < 400; x += 1) {
      for (let y = 0; y < frame.ground; y += 1) {
        if (hdPlantPixel(frame, x, y) !== undefined) {
          tall.add(y)
        }
      }
    }
    expect(frame.ground - Math.min(...tall)).toBeGreaterThanOrEqual(8)
  })

  it('textures the ground', () => {
    const colors = new Set<number>()
    for (let x = 0; x < 130; x += 1) {
      for (let y = frame.ground; y < frame.pixels; y += 1) {
        colors.add(hdGroundPixel(frame, x, y))
      }
    }
    expect(colors.size).toBeGreaterThan(3)
  })
})

describe('hd characters', () => {
  it('draws the hero outlined in its own ink with its costume colours', () => {
    const grid = hdSceneGridOf(input({ isResting: true, caption: '' }))
    const colors = new Set(
      grid.flatMap((cell) => (cell[0] === UPPER_HALF ? [cell[1], cell[2]] : []))
    )
    const costume = QUEST.costumes.build
    expect(colors.has(outlineOf(costume.colors))).toBe(true)
    expect(colors.has(costume.colors.O ?? -1)).toBe(true)
  })

  it('casts a shadow on the ground under a standing hero', () => {
    const rows = HD_ROWS
    const columns = 130
    const grid = hdSceneGridOf(input({ isResting: true, caption: '', tick: 0 }))
    const frame = hdFrameOf({ look: QUEST.looks.build, width: columns, rows, tick: 0, scroll: 0 })
    const left = Math.floor((columns - 12) / 3)
    const x = left + 4
    expect(pixelOf(grid, columns, x, frame.ground)).not.toBe(hdGroundPixel(frame, x, frame.ground))
    expect(distance(pixelOf(grid, columns, x, frame.ground), 0)).toBeLessThan(
      distance(hdGroundPixel(frame, x, frame.ground), 0)
    )
  })

  it('outlines a scene file’s hero with ink from the file’s own palette', () => {
    const colors = { C: 0x2a9d8f, H: 0xe9c46a, S: 0xf4a261, E: 0x264653, R: 0xe76f51 }
    const costume = {
      rows: ['...CCCC...', '..CCCCCC..', '..HSSESS..', '..SSSSSS..', '..RRRRRR..', '.SRRRRRRS.'],
      legs: ['..HH..HH..', '.HH....HH.'] as [string, string],
      colors
    }
    const file = {
      ...QUEST,
      id: 'file:.orca/scenes/teal.json',
      costumes: {
        working: costume,
        docs: costume,
        build: costume,
        verify: costume,
        pr: costume,
        handoff: costume
      }
    }
    const grid = hdSceneGridOf(input({ scene: file, isResting: true, caption: '' }))
    const shown = new Set(grid.flatMap((cell) => [cell[1], cell[2]]))
    expect(shown.has(outlineOf(colors))).toBe(true)
    expect(shown.has(colors.R)).toBe(true)
    expect(costumeSpriteOf(costume, 0, false).outline).toBe(outlineOf(colors))
  })
})
