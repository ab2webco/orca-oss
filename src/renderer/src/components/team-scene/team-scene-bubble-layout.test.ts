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
      [{ key: 'advisor', anchor: { x: 395, top: 120 }, width: 150, height: 30 }],
      { width: 400, height: 176 }
    )
    expect(box!.left + box!.width).toBeLessThanOrEqual(400)
    expect(box!.tailX).toBeGreaterThan(box!.width / 2)
  })

  it('fits both bubbles without overlap at every width down to 320', () => {
    for (const width of [320, 360, 390, 480, 768]) {
      for (const textWidth of [60, 120, 170]) {
        const boxes = layoutTeamSceneBubbles(
          [
            { key: 'lead', anchor: { x: width * 0.84, top: 110 }, width: textWidth, height: 30 },
            { key: 'advisor', anchor: { x: width * 0.95, top: 104 }, width: textWidth, height: 44 }
          ],
          { width, height: 176 }
        )
        expect(boxes).toHaveLength(2)
        expect(overlaps(boxes[0]!, boxes[1]!)).toBe(false)
        for (const box of boxes) {
          expect(box.left).toBeGreaterThanOrEqual(0)
          expect(box.left + box.width).toBeLessThanOrEqual(width)
          expect(box.top).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('places the first bubble first, so the lead keeps its spot', () => {
    const lead = { key: 'lead', anchor: { x: 300, top: 110 }, width: 100, height: 30 }
    const alone = layoutTeamSceneBubbles([lead], { width: 400, height: 176 })
    const shared = layoutTeamSceneBubbles(
      [lead, { key: 'advisor', anchor: { x: 380, top: 104 }, width: 100, height: 30 }],
      { width: 400, height: 176 }
    )
    expect(shared[0]).toEqual(alone[0])
  })
})
