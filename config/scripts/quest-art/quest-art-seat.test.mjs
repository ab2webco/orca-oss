// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { figureSeedOf } from '../../../src/renderer/src/components/team-scene/team-scene-figure-looks'
import { createImagePainter } from '../../../src/renderer/src/components/team-scene/team-scene-image-painter'
import { recordingContext } from '../../../src/renderer/src/components/team-scene/team-scene-recording-context'

const ART = resolve(import.meta.dirname, '../../../src/renderer/src/assets/quest-art')
const office = JSON.parse(readFileSync(resolve(ART, 'native.json'), 'utf8')).native.office
const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3' }
// The chair is painted in this one colour (quest-art-stage.mjs `chair`); the desk is #1b1e26.
const CHAIR = [0x14, 0x17, 0x1e]

const read = (src) => PNG.sync.read(readFileSync(resolve(ART, src)))
const pixelsOf = (png, keep, box = { x: 0, y: 0, width: png.width, height: png.height }) => {
  const out = []
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * png.width + x) * 4
      if (keep(png.data.subarray(i, i + 4))) {
        out.push({ x: x - box.x, y: y - box.y })
      }
    }
  }
  return out
}

// The seat is the topmost run of chair pixels wider than the backrest.
function seatOf(desk) {
  const chair = pixelsOf(
    desk,
    ([r, g, b, a]) => a > 200 && [r, g, b].every((c, i) => Math.abs(c - CHAIR[i]) <= 3)
  )
  const rows = new Map()
  for (const p of chair) {
    rows.set(p.y, [...(rows.get(p.y) ?? []), p.x])
  }
  const wide = [...rows].filter(([, xs]) => xs.length >= 24).sort((a, b) => a[0] - b[0])
  const top = wide[0][0]
  const xs = wide[0][1]
  let bottom = top
  while (wide.some(([y]) => y === bottom + 1)) {
    bottom += 1
  }
  return { top, bottom, left: Math.min(...xs), right: Math.max(...xs) }
}

let images
// A character whose look the painter draws from sheet `at`.
const keyFor = (at) => {
  for (let n = 0; ; n++) {
    if (figureSeedOf(`c${n}`) % office.roles.member.sheets.length === at) {
      return `c${n}`
    }
  }
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g)
})
afterEach(() => vi.restoreAllMocks())

// ORCA-1139 criterion 7: V28's office seats each worker on its chair, not on the floor beside it.
describe("Quest's Office seats a working member on the chair", () => {
  const desk = read(office.props.station)
  const seat = seatOf(desk)
  const member = office.roles.member
  images = new Map(
    [
      ...office.layers.map((l) => l.src),
      office.props.station,
      ...member.sheets,
      office.roles.lead.sheets[0]
    ]
      .concat(office.roles.advisor?.sheets ?? [])
      .map((src) => {
        const png = read(src)
        return [src, { width: png.width, height: png.height }]
      })
  )

  for (const width of [1440, 768, 390, 320]) {
    for (const sheet of member.sheets) {
      it(`${sheet} at ${width} px`, () => {
        const painter = createImagePainter({ art: { style: office, images }, colors: COLORS })
        const spot = { x: 0.1, depth: 0.55 }
        const { g, calls } = recordingContext()
        painter.paint(g, {
          width,
          height: 176,
          ratio: 1,
          t: 0,
          dt: 1 / 30,
          actors: [
            {
              key: 'm',
              role: 'member',
              name: 'm',
              characterKey: keyFor(member.sheets.indexOf(sheet)),
              x: spot.x,
              depth: spot.depth,
              facing: 1,
              pose: 'work',
              gait: 0,
              stride: 8,
              carrying: false,
              emote: null,
              jump: 0
            }
          ],
          effects: [],
          overflow: 0,
          stations: [spot],
          sites: [],
          trophies: []
        })
        const draws = calls.filter((c) => c.name === 'drawImage')
        const station = draws.find((c) => c.args[0] === images.get(office.props.station))
        const sprite = draws.find((c) => c.args.length === 9)
        const [image, ...placed] = sprite.args
        const [sx, sy, sw, sh, dx, dy, dw] = placed.map(Number)
        const sheetSrc = [...images].find(([, one]) => one === image)[0]
        expect(sheetSrc).toBe(sheet)
        const [tx, ty] = calls.findLast((c) => c.name === 'translate').args.map(Number)
        const px = dw / sw
        const [propX, propY, propW] = station.args.slice(1).map(Number)
        const propPx = propW / desk.width
        const stage = (x, y) => ({ x: propX + x * propPx, y: propY + y * propPx })
        const seatLeft = stage(seat.left, seat.top).x
        const seatRight = stage(seat.right, seat.top).x
        const seatTop = stage(seat.left, seat.top).y
        const seatBottom = stage(seat.left, seat.bottom + 1).y
        // The body's bottom: the lowest pixel under the hip, behind the shins drawn ahead of it.
        const frame = pixelsOf(read(sheet), ([, , , a]) => a > 128, {
          x: sx,
          y: sy,
          width: sw,
          height: sh
        })
        const feetX = member.feet.x
        const hip = frame.filter((p) => p.x >= feetX - 10 && p.x <= feetX + 4)
        const bottom = ty + dy + Math.max(...hip.map((p) => p.y)) * px
        const middle =
          tx + dx + ((Math.min(...hip.map((p) => p.x)) + Math.max(...hip.map((p) => p.x))) / 2) * px
        expect(middle, 'the body is over the seat').toBeGreaterThanOrEqual(seatLeft)
        expect(middle, 'the body is over the seat').toBeLessThanOrEqual(seatRight)
        expect(bottom, 'the body rests on the seat, not above it').toBeGreaterThanOrEqual(seatTop)
        expect(bottom, 'the body rests on the seat, not the floor').toBeLessThanOrEqual(seatBottom)
      })
    }
  }
})
