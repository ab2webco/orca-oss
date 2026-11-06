import { describe, expect, it } from 'vitest'
import { layoutTeamSceneBubbles, type TeamSceneBubbleBox } from './team-scene-bubble-layout'

const overlaps = (a: TeamSceneBubbleBox, b: TeamSceneBubbleBox): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height

describe('layoutTeamSceneBubbles', () => {
  it('centres a lone bubble above its speaker with the tail on it', () => {
    const [box] = layoutTeamSceneBubbles(
      [{ key: 'lead', anchor: { x: 200, top: 100 }, width: 80, height: 30 }],
      { width: 400, height: 176 }
    )
    expect(box).toMatchObject({ key: 'lead', left: 160, tailX: 40 })
    expect(box!.top + box!.height).toBeLessThanOrEqual(100)
  })

  it('keeps a bubble inside the scene near an edge', () => {
    const [box] = layoutTeamSceneBubbles(
      [{ key: 'advisor', anchor: { x: 380, top: 120 }, width: 150, height: 30 }],
      { width: 400, height: 176 }
    )
    expect(box!.left + box!.width).toBeLessThanOrEqual(400)
    expect(box!.left + box!.tailX).toBe(380)
  })

  it('fits both bubbles, with tails that reach their speakers and cross nothing, down to 320', () => {
    for (const width of [320, 360, 390, 480, 768]) {
      for (const textWidth of [60, 120, 170]) {
        const boxes = layoutTeamSceneBubbles(
          [
            {
              key: 'advisor',
              anchor: { x: width * 0.74, top: 104 },
              width: textWidth,
              height: 44,
              align: 'end'
            },
            { key: 'lead', anchor: { x: width * 0.84, top: 110 }, width: textWidth, height: 30 }
          ],
          { width, height: 176 }
        )
        expect(boxes).toHaveLength(2)
        expect(overlaps(boxes[0]!, boxes[1]!)).toBe(false)
        const anchors = { lead: width * 0.84, advisor: width * 0.74 }
        const tops = { lead: 110, advisor: 104 }
        for (const box of boxes) {
          const key = box.key as 'lead' | 'advisor'
          const tailX = box.left + box.tailX
          // The tail meets its own speaker and passes no other bubble on the way down.
          expect(Math.abs(tailX - anchors[key])).toBeLessThanOrEqual(1)
          for (const other of boxes.filter((o) => o !== box)) {
            const inColumn = tailX >= other.left && tailX <= other.left + other.width
            const inRows = other.top < tops[key] && other.top + other.height > box.top + box.height
            expect(inColumn && inRows).toBe(false)
          }
        }
        for (const box of boxes) {
          expect(box.left).toBeGreaterThanOrEqual(0)
          expect(box.left + box.width).toBeLessThanOrEqual(width)
          expect(box.top).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('keeps the advisor by its speaker and lifts the lead above it when they would touch', () => {
    const advisor = {
      key: 'advisor',
      anchor: { x: 296, top: 104 },
      width: 160,
      height: 30,
      align: 'end' as const
    }
    const alone = layoutTeamSceneBubbles([advisor], { width: 400, height: 176 })
    const [kept, lead] = layoutTeamSceneBubbles(
      [advisor, { key: 'lead', anchor: { x: 336, top: 110 }, width: 120, height: 30 }],
      { width: 400, height: 176 }
    )
    expect(kept).toEqual(alone[0])
    expect(kept!.left + kept!.width).toBe(296 + 22)
    expect(lead!.top + lead!.height).toBeLessThan(kept!.top)
  })

  it('leaves a bubble out rather than run its tail through another', () => {
    const boxes = layoutTeamSceneBubbles(
      [
        { key: 'first', anchor: { x: 300, top: 110 }, width: 120, height: 30 },
        { key: 'second', anchor: { x: 320, top: 110 }, width: 120, height: 30 }
      ],
      { width: 400, height: 176 }
    )
    expect(boxes.map((b) => b.key)).toEqual(['first'])
  })
})
