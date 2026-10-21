import { describe, expect, it } from 'vitest'

import { costumeSpriteOf, outlineOf } from '../hooks/hd-sprite'
import { daylightAt } from '../hooks/hd-daylight'
import { apartFromSky } from '../hooks/hd-layer-contrast'
import { lightnessOf } from '../hooks/hd-lightness'
import { mix, UPPER_HALF } from '../hooks/pixel-canvas'
import { HD_ROWS, hdRowsOf, hdSceneGridOf, type HdSceneInput } from '../hooks/scene-hd'
import {
  hdFarPixel,
  hdFrameOf,
  hdGroundPixel,
  hdMidPixel,
  hdPlantPixel,
  hdSkyBaseOf,
  hdSkyPixel
} from '../hooks/scene-hd-land'
import { skyRowOf } from '../hooks/scene-hd-sky'
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
  it('grows with the pane, a quarter of its rows, from 9 to 14', () => {
    expect(hdRowsOf(undefined)).toBe(9)
    expect(hdRowsOf(30)).toBe(9)
    expect(hdRowsOf(40)).toBe(10)
    expect(hdRowsOf(45)).toBe(11)
    expect(hdRowsOf(50)).toBe(13)
    expect(hdRowsOf(56)).toBe(14)
    expect(hdRowsOf(200)).toBe(14)
  })

  it('fills rows × columns for every built-in scene and phase at any width, without throwing', () => {
    for (const scene of Object.values(SCENES)) {
      for (const phase of [undefined, 'docs', 'build', 'verify', 'pr', 'handoff'] as const) {
        for (const columns of [1, 2, 7, 13, 20, 60, 130]) {
          for (const rows of [9, 10, 14]) {
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

  it('puts a sun disc with no glow around it, so its edge is hard', () => {
    const sunY = Math.round(frame.sunY)
    expect(hdSkyBaseOf(frame, frame.sunX, sunY)).toBe(LOOK.sun)
    const beside = hdSkyBaseOf(frame, frame.sunX + Math.ceil(frame.sunR * 1.6), sunY)
    expect(beside).toBe(hdSkyBaseOf(frame, 2, sunY))
  })

  it('moves the sun east to west through the day, highest at noon', () => {
    const sunAt = (hour: number) => {
      const one = hdFrameOf({
        look: LOOK,
        width: 130,
        rows: 9,
        tick: 0,
        scroll: 0,
        light: daylightAt(hour)
      })
      return { x: one.sunX, y: one.sunY }
    }
    expect(sunAt(9).x).toBeLessThan(sunAt(12).x)
    expect(sunAt(12).x).toBeLessThan(sunAt(15).x)
    expect(sunAt(12).y).toBeLessThan(sunAt(9).y)
    expect(sunAt(7).y).toBeGreaterThan(sunAt(9).y)
  })

  it('lays no light shafts over the sky: a clear pixel is the bare gradient', () => {
    for (let y = 0; y < frame.ground; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const base = hdSkyBaseOf(frame, x, y)
        const clouded = [mix(base, frame.cloud, 0.92), mix(base, frame.cloud, 0.6)]
        const pixel = hdSkyPixel(frame, x, y)
        expect(pixel === base || clouded.includes(pixel), `${x},${y}`).toBe(true)
      }
    }
  })

  it('paints far scenery in its own textured tones, never hazed toward the sky', () => {
    // Why a mean against the flat layer: haze pulls every pixel toward the sky, texture only spreads them.
    const flat: number[] = []
    const drawn: number[] = []
    const tones = new Set<number>()
    for (let y = 0; y < frame.ground; y += 1) {
      const sky = lightnessOf(skyRowOf(frame, y))
      for (let x = 0; x < frame.width; x += 1) {
        const far = hdFarPixel(frame, x, y)
        if (far !== undefined) {
          drawn.push(Math.abs(lightnessOf(far) - sky))
          flat.push(Math.abs(lightnessOf(apartFromSky(LOOK.far, frame.far, y)) - sky))
          tones.add(far)
        }
      }
    }
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length
    expect(drawn.length).toBeGreaterThan(20)
    expect(tones.size).toBeGreaterThanOrEqual(6)
    expect(mean(drawn)).toBeGreaterThan(mean(flat) - 3)
  })

  it('leaves the edge columns the colour of the sky behind them, with no vignette', () => {
    const columns = 130
    const grid = hdSceneGridOf(input({ columns, light: daylightAt(12) }))
    const lit = hdFrameOf({
      look: QUEST.looks.build,
      width: columns,
      rows: HD_ROWS,
      tick: 41,
      scroll: 41,
      light: daylightAt(12)
    })
    const kept: boolean[] = []
    for (const x of [0, 1, columns - 2, columns - 1]) {
      for (let y = 0; y < lit.ground; y += 1) {
        if (hdFarPixel(lit, x, y) === undefined && hdMidPixel(lit, x, y) === undefined) {
          kept.push(pixelOf(grid, columns, x, y) === hdSkyPixel(lit, x, y))
        }
      }
    }
    expect(kept.length).toBeGreaterThan(8)
    expect(kept.filter(Boolean).length).toBeGreaterThan(kept.length * 0.9)
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
  it('keeps the hero its art’s size on a taller band, so it never fills the band', () => {
    const outline = outlineOf(QUEST.costumes.working.colors)
    const heroRows = (rows: number): number => {
      const columns = 90
      const grid = hdSceneGridOf(
        input({ columns, rows, phase: 'working', isResting: true, caption: '' })
      )
      return Array.from({ length: rows * 2 }, (_, y) =>
        Array.from({ length: columns }, (_, x) => pixelOf(grid, columns, x, y)).includes(outline)
      ).filter(Boolean).length
    }
    expect(heroRows(10)).toBeGreaterThan(4)
    expect(heroRows(14)).toBe(heroRows(10))
  })

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
