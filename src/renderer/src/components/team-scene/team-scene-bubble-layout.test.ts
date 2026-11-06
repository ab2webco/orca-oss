import { describe, expect, it } from 'vitest'
import { NOON } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import { teamSceneActors } from '../../../../shared/team-scene/team-scene-actors'
import {
  applyTeamSceneInput,
  createTeamSceneWorld
} from '../../../../shared/team-scene/team-scene-director'
import { layoutTeamSceneBubbles, type TeamSceneBubbleBox } from './team-scene-bubble-layout'
import { createImagePainter } from './team-scene-image-painter'
import { createPixelPainter } from './team-scene-pixel-painter'
import { teamSceneQuestArtOf } from './team-scene-quest-art'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3' }
// The panel's stage at the 390 and 320 viewports is 219 px wide; the rest are wider panels.
const STAGE_WIDTHS = [219, 320, 480, 768]
// One and two lines, from TeamSceneBubbles' classes: glass is 10.5 px snug text with py-1 and a
// hairline, Pixel's cloud 10 px tight text with pt-4 and pb-3.
const STAGES = [
  ...(['figures', 'office'] as const).map((style) => ({
    style,
    painter: createImagePainter({
      art: { style: teamSceneQuestArtOf(style), images: new Map() },
      colors: COLORS
    }),
    heights: [25, 39],
    beside: false
  })),
  {
    style: 'pixel',
    painter: createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS }),
    heights: [41, 53],
    beside: true
  }
]
const SPEAKERS = (() => {
  const world = createTeamSceneWorld()
  applyTeamSceneInput(world, {
    lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
    advisor: { line: null },
    members: []
  })
  const spot = (role: 'lead' | 'advisor') => teamSceneActors(world).find((a) => a.role === role)!
  return { lead: spot('lead'), advisor: spot('advisor') }
})()

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

  it("fits the lead's and advisor's bubbles on every style's real stage, down to the 219 px panel", () => {
    // Why every pairing: the advisor's line is often long and the lead's a short tool name.
    const sizes = (heights: number[]) =>
      [60, 120, 170].flatMap((width) => heights.map((height) => ({ width, height })))
    for (const stage of STAGES) {
      for (const width of STAGE_WIDTHS) {
        for (const advisorSize of sizes(stage.heights)) {
          for (const leadSize of sizes(stage.heights)) {
            const at = (key: 'lead' | 'advisor') => ({
              x: SPEAKERS[key].x * width,
              top: stage.painter.headTop(SPEAKERS[key].depth, stage.painter.height)
            })
            const anchors = { advisor: at('advisor'), lead: at('lead') }
            const asked = { advisor: advisorSize, lead: leadSize }
            const boxes = layoutTeamSceneBubbles(
              [
                { key: 'advisor', anchor: anchors.advisor, ...advisorSize, align: 'end' },
                { key: 'lead', anchor: anchors.lead, ...leadSize }
              ],
              { width, height: stage.painter.height },
              { beside: stage.beside }
            )
            const where = `${stage.style} ${width} px, advisor ${advisorSize.width}x${advisorSize.height}, lead ${leadSize.width}x${leadSize.height}`
            expect(boxes.map((box) => box.key).sort(), where).toEqual(['advisor', 'lead'])
            expect(overlaps(boxes[0]!, boxes[1]!), where).toBe(false)
            for (const box of boxes) {
              const key = box.key as 'lead' | 'advisor'
              const anchor = anchors[key]
              const tailX = box.left + box.tailX
              expect(box.width, where).toBeLessThanOrEqual(asked[key].width)
              expect(box.left, where).toBeGreaterThanOrEqual(0)
              expect(box.left + box.width, where).toBeLessThanOrEqual(width)
              expect(box.top, where).toBeGreaterThanOrEqual(0)
              expect(box.top + box.height, where).toBeLessThanOrEqual(anchor.top)
              // Why only glass: Pixel's cloud trail drifts toward its speaker from a shared row.
              if (!stage.beside) {
                expect(Math.abs(tailX - anchor.x), where).toBeLessThanOrEqual(1)
              }
              // The tail passes no other bubble on its way down.
              for (const other of boxes.filter((o) => o !== box)) {
                const inColumn = tailX >= other.left && tailX <= other.left + other.width
                const inRows =
                  other.top < anchor.top && other.top + other.height > box.top + box.height
                expect(inColumn && inRows, where).toBe(false)
              }
            }
          }
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
    expect(kept!.left + kept!.width).toBe(296 + 14)
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

  it('sets bubbles side by side when there is no room to stack them, as Pixel needs', () => {
    const boxes = layoutTeamSceneBubbles(
      [
        { key: 'advisor', anchor: { x: 287, top: 84 }, width: 160, height: 50, align: 'end' },
        { key: 'lead', anchor: { x: 326, top: 84 }, width: 150, height: 50 }
      ],
      { width: 388, height: 126 },
      { beside: true }
    )
    expect(boxes.map((b) => b.key)).toEqual(['advisor', 'lead'])
    const [advisor, lead] = boxes
    expect(overlaps(advisor!, lead!)).toBe(false)
    for (const box of boxes) {
      expect(box.tailX).toBeGreaterThanOrEqual(10)
      expect(box.tailX).toBeLessThanOrEqual(box.width - 10)
      expect(box.left + box.width).toBeLessThanOrEqual(388)
    }
  })

  it('narrows two clouds to share a 320 px row instead of dropping one', () => {
    const boxes = layoutTeamSceneBubbles(
      [
        { key: 'advisor', anchor: { x: 235, top: 84 }, width: 170, height: 41, align: 'end' },
        { key: 'lead', anchor: { x: 267, top: 84 }, width: 170, height: 41 }
      ],
      { width: 318, height: 126 },
      { beside: true }
    )
    expect(boxes).toHaveLength(2)
    const [advisor, lead] = boxes
    expect(overlaps(advisor!, lead!)).toBe(false)
    expect(advisor!.left).toBeGreaterThanOrEqual(6)
    expect(lead!.left + lead!.width).toBeLessThanOrEqual(312)
    // A narrowed cloud wraps one more line, and it still clears its speaker's head.
    expect(lead!.height).toBeGreaterThan(41)
    expect(lead!.top + lead!.height).toBeLessThanOrEqual(84)
  })
})
