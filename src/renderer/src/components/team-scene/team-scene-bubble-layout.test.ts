import { describe, expect, it } from 'vitest'
import { NOON } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import { teamSceneActors } from '../../../../shared/team-scene/team-scene-actors'
import {
  applyTeamSceneInput,
  createTeamSceneWorld,
  stepTeamScene
} from '../../../../shared/team-scene/team-scene-director'
import {
  layoutTeamSceneBubbles,
  teamSceneCellUnder,
  teamSceneTailRunsOf,
  type TeamSceneBubbleBox
} from './team-scene-bubble-layout'
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
const ASKER_INPUT = {
  key: 'm',
  name: 'ORCA-14',
  characterKey: null,
  activity: 'needsYou',
  reportId: null,
  mergedPr: null,
  site: { stage: 0, broken: false }
} as const
// The member who asks, and its tag as TeamSceneCanvas places it: 56 px wide, 18 tall, centred
// 38 px over the head and no nearer the edge than 32 px.
const ASKER = (() => {
  const world = createTeamSceneWorld()
  applyTeamSceneInput(world, {
    lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
    advisor: { line: null },
    members: [{ ...ASKER_INPUT }]
  })
  return teamSceneActors(world).find((a) => a.role === 'member')!
})()
const tagOn = (stage: (typeof STAGES)[number], width: number) => ({
  left: Math.round(Math.max(ASKER.x * width, 32)) - 28,
  top: Math.round(stage.painter.headTop(ASKER.depth, stage.painter.height) - 38),
  width: 56,
  height: 18
})

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

  // ORCA-1139 criterion 8: at the 390 and 320 viewports both bubbles sat over ORCA-14's tag.
  it("never lays a bubble or its tail over an asking member's tag", () => {
    const sizes = (heights: number[]) =>
      [60, 120, 170].flatMap((width) => heights.map((height) => ({ width, height })))
    for (const stage of STAGES) {
      for (const width of STAGE_WIDTHS) {
        const tag = tagOn(stage, width)
        const anchors = {
          advisor: {
            x: SPEAKERS.advisor.x * width,
            top: stage.painter.headTop(SPEAKERS.advisor.depth, stage.painter.height)
          },
          lead: {
            x: SPEAKERS.lead.x * width,
            top: stage.painter.headTop(SPEAKERS.lead.depth, stage.painter.height)
          }
        }
        const pairs = sizes(stage.heights).flatMap((advisor) =>
          sizes(stage.heights).map((lead) => ({ advisor, lead }))
        )
        for (const { advisor, lead } of [
          ...pairs,
          ...sizes(stage.heights).map((one) => ({ advisor: null, lead: one }))
        ]) {
          const boxes = layoutTeamSceneBubbles(
            [
              ...(advisor
                ? [{ key: 'advisor', anchor: anchors.advisor, ...advisor, align: 'end' as const }]
                : []),
              { key: 'lead', anchor: anchors.lead, ...lead }
            ],
            { width, height: stage.painter.height },
            { beside: stage.beside, obstacles: [tag] }
          )
          const where = `${stage.style} ${width} px, advisor ${advisor ? `${advisor.width}x${advisor.height}` : 'none'}, lead ${lead.width}x${lead.height}`
          for (const box of boxes) {
            const anchor = anchors[box.key as 'lead' | 'advisor']
            const tailX = box.left + box.tailX
            expect(overlaps(box, { ...tag, key: 'tag', tailX: 0 }), `${where}: ${box.key}`).toBe(
              false
            )
            const tailInColumn = tailX >= tag.left && tailX <= tag.left + tag.width
            const tailInRows = tag.top < anchor.top && tag.top + tag.height > box.top + box.height
            expect(tailInColumn && tailInRows, `${where}: ${box.key}'s tail`).toBe(false)
          }
        }
      }
    }
  })

  it("lifts the lead's one-line bubble above the tag on the 219 px stage instead of covering it", () => {
    for (const stage of STAGES) {
      const lineHeight = stage.heights[0]!
      const tag = tagOn(stage, 219)
      const anchor = {
        x: SPEAKERS.lead.x * 219,
        top: stage.painter.headTop(SPEAKERS.lead.depth, stage.painter.height)
      }
      const [box] = layoutTeamSceneBubbles(
        [{ key: 'lead', anchor, width: 170, height: lineHeight }],
        { width: 219, height: stage.painter.height },
        { beside: stage.beside, obstacles: [tag] }
      )
      expect(box, stage.style).toBeDefined()
      expect(box!.top + box!.height, stage.style).toBeLessThanOrEqual(tag.top)
    }
  })

  // Why: the lead stays beside a member who needs you (lead rounds), right under that member's tag.
  it("shows the lead's bubble while it stands by the asking member, on every stage", () => {
    for (const stage of STAGES) {
      for (const width of STAGE_WIDTHS) {
        const world = createTeamSceneWorld()
        applyTeamSceneInput(world, {
          lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
          advisor: null,
          members: [{ ...ASKER_INPUT }]
        })
        for (let t = 0; t < 20; t += 1 / 30) {
          stepTeamScene(world, 1 / 30, { width })
        }
        expect(world.rounds.stage, `${stage.style} ${width}`).toBe('atMember')
        const lead = teamSceneActors(world).find((a) => a.role === 'lead')!
        const anchor = {
          x: lead.x * width,
          top: stage.painter.headTop(lead.depth, stage.painter.height)
        }
        const tag = tagOn(stage, width)
        const scene = { width, height: stage.painter.height }
        const opts = { beside: stage.beside, obstacles: [tag] }
        // Why every size: the lead's line runs from a short step to two lines at the cap.
        for (const size of [60, 120, 170].flatMap((w) => stage.heights.map((h) => ({ w, h })))) {
          // Why a one-line size: with no room for two, the attending lead's line clamps to one.
          const oneLine = { width: size.w, height: stage.heights[0]! }
          const request = { key: 'lead', anchor, width: size.w, height: size.h, oneLine }
          const where = `${stage.style} ${width} px ${size.w}x${size.h}`
          const boxes = layoutTeamSceneBubbles([{ ...request, attending: true }], scene, opts)
          expect(
            boxes.map((b) => b.key),
            where
          ).toEqual(['lead'])
          // Clamped only where two lines found no spot.
          if (boxes[0]!.clamped) {
            expect(boxes[0]!.height, where).toBe(oneLine.height)
            const unclamped = { ...request, attending: true, oneLine: undefined }
            expect(layoutTeamSceneBubbles([unclamped], scene, opts), where).toEqual([])
          }
          // The tail may pass behind the tag; the bubble itself never covers it.
          expect(overlaps(boxes[0]!, { ...tag, key: 'tag', tailX: 0 }), where).toBe(false)
          // Behind a tag only as a last resort: where a clear spot exists, it takes that one.
          const clear = layoutTeamSceneBubbles([request], scene, opts)
          if (clear.length > 0) {
            expect(boxes, where).toEqual(clear)
          }
        }
      }
    }
  })

  // ORCA-1139 criterion 8, lead decision A: on the 219 px stage the tag leaves room for one bubble.
  it("gives the lead's bubble the room when only one fits beside a tag, and both come back without it", () => {
    const cases = [
      { stage: STAGES[2]!, advisor: { width: 120, height: 41 }, lead: { width: 90, height: 41 } },
      { stage: STAGES[2]!, advisor: { width: 170, height: 53 }, lead: { width: 90, height: 41 } },
      { stage: STAGES[0]!, advisor: { width: 170, height: 39 }, lead: { width: 90, height: 25 } }
    ]
    for (const { stage, advisor, lead } of cases) {
      const at = (key: 'lead' | 'advisor') => ({
        x: SPEAKERS[key].x * 219,
        top: stage.painter.headTop(SPEAKERS[key].depth, stage.painter.height)
      })
      const requests = [
        { key: 'advisor', anchor: at('advisor'), ...advisor, align: 'end' as const, yields: true },
        { key: 'lead', anchor: at('lead'), ...lead }
      ]
      const scene = { width: 219, height: stage.painter.height }
      const where = `${stage.style}, advisor ${advisor.width}x${advisor.height}`
      const crowded = layoutTeamSceneBubbles(requests, scene, {
        beside: stage.beside,
        obstacles: [tagOn(stage, 219)]
      })
      expect(
        crowded.map((box) => box.key),
        where
      ).toEqual(['lead'])
      const free = layoutTeamSceneBubbles(requests, scene, { beside: stage.beside })
      expect(free.map((box) => box.key).sort(), where).toEqual(['advisor', 'lead'])
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

// Why: decision A lets an attending lead's tail run behind the asker's tag, so none of it may be
// drawn over the tag (run on 768 Pixel: 'lead cloud paints 5 cells over the tag').
describe('a tail behind a tag', () => {
  const box = { key: 'lead', left: 10, top: 0, width: 80, height: 30, tailX: 30 }
  const tag = { left: 20, top: 40, width: 56, height: 18 }

  it('draws the tail only above and below the tag it passes behind', () => {
    // From the bubble's bottom (30) to the head (90), with the tag between 40 and 58.
    expect(teamSceneTailRunsOf(box, 90, [tag])).toEqual([
      { from: 30, to: 40 },
      { from: 58, to: 90 }
    ])
    expect(teamSceneTailRunsOf(box, 90, [])).toEqual([{ from: 30, to: 90 }])
    expect(teamSceneTailRunsOf({ ...box, tailX: 70 }, 90, [{ ...tag, width: 10 }])).toEqual([
      { from: 30, to: 90 }
    ])
  })

  it('tells which scene cells lie under a tag, so a cloud leaves them unpainted', () => {
    expect(teamSceneCellUnder({ x: 40, y: 45, size: 3 }, [tag])).toBe(true)
    expect(teamSceneCellUnder({ x: 40, y: 36, size: 3 }, [tag])).toBe(false)
    // A cell that only touches the tag's edge does not cover it.
    expect(teamSceneCellUnder({ x: 19, y: 45, size: 2 }, [tag])).toBe(true)
    expect(teamSceneCellUnder({ x: 18, y: 45, size: 2 }, [tag])).toBe(false)
  })
})
