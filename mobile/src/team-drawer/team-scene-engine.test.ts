// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { orchestratorGameSceneArtFiles } from '../../../src/shared/orchestrator-game-scene-native'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../src/shared/team-scene/team-scene-types'
import {
  createTeamSceneEngine,
  teamSceneQuestNativeOf,
  type TeamSceneEngine,
  type TeamSceneEngineEvent
} from './team-scene-engine'
import { TEAM_SCENE_NAME_STRIP } from './team-scene-engine-names'

const QUEST_ART = join(import.meta.dirname, '../../../src/renderer/src/assets/quest-art')
const COLORS = { attention: '#f00', done: '#0f0', working: '#00f', risk: '#fa0' }

type Bitmap = { src: string; width: number; height: number }
type Call = { name: string; args: unknown[] }

// Why the real headers: the painters lay out desks and frames from each image's true size.
const pngSize = (src: string): { width: number; height: number } => {
  const bytes = readFileSync(join(QUEST_ART, src))
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** A 2D context that draws nothing and records every call, so a test reads what was painted. */
function recordingContext(calls: Call[]): CanvasRenderingContext2D {
  const fields: Record<string | symbol, unknown> = {}
  const gradient = { addColorStop: () => {} }
  return new Proxy(fields, {
    get: (target, prop) => {
      if (prop in target) {
        return target[prop]
      }
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args })
        switch (prop) {
          case 'measureText':
            return { width: String(args[0]).length * 6 }
          case 'getImageData':
            return { data: new Uint8ClampedArray(4 * Number(args[2]) * Number(args[3])) }
          case 'createLinearGradient':
          case 'createRadialGradient':
          case 'createPattern':
            return gradient
          default:
            return undefined
        }
      }
    },
    set: (target, prop, value) => {
      target[prop] = value
      return true
    }
  }) as unknown as CanvasRenderingContext2D
}

let calls: Call[] = []
/** The frames the engine asked for and has not cancelled, by id. */
let frames = new Map<number, (now: number) => void>()
let frameId = 0

beforeEach(() => {
  calls = []
  frames = new Map()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => recordingContext(calls) as never
  )
})
afterEach(() => vi.restoreAllMocks())

const member = (
  key: string,
  name: string,
  activity: TeamSceneMemberInput['activity']
): TeamSceneMemberInput => ({
  key,
  name,
  characterKey: null,
  activity,
  reportId: null,
  mergedPr: null,
  site: { stage: 0, broken: false }
})

const inputOf = (members: TeamSceneMemberInput[]): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Alfred', characterKey: null, activity: 'working' },
  advisor: null,
  members
})

function mount(width = 390): { engine: TeamSceneEngine; events: TeamSceneEngineEvent[] } {
  const stage = document.createElement('div')
  const canvas = document.createElement('canvas')
  const names = document.createElement('div')
  stage.append(canvas, names)
  document.body.replaceChildren(stage)
  const events: TeamSceneEngineEvent[] = []
  const engine = createTeamSceneEngine({
    canvas,
    overlay: stage,
    names,
    width: () => width,
    ratio: () => 1,
    reducedMotion: false,
    scheduler: {
      request: (cb) => {
        frameId += 1
        frames.set(frameId, cb)
        return frameId
      },
      cancel: (id) => frames.delete(id)
    },
    decode: async (url) => ({ src: url, ...pngSize(url) }) as Bitmap as never,
    post: (event) => events.push(event)
  })
  return { engine, events }
}

const officeImages = (): Record<string, string> =>
  Object.fromEntries(
    orchestratorGameSceneArtFiles({ office: teamSceneQuestNativeOf('office') }).map((src) => [
      src,
      src
    ])
  )

async function officeStage(engine: TeamSceneEngine): Promise<void> {
  await engine.receive({
    kind: 'stage',
    stage: {
      art: { kind: 'bundled', style: 'office' },
      images: officeImages(),
      scenes: [],
      timezone: 'UTC',
      nowMs: 0,
      colors: COLORS
    }
  })
}

/** The name labels in the strip under the stage, as boxes. */
const nameBoxes = () =>
  [...document.querySelectorAll<HTMLElement>('[data-scene-name]')].map((el) => {
    const [left, top, width, height] = ['left', 'top', 'width', 'height'].map((side) =>
      Number.parseFloat(el.style.getPropertyValue(side))
    )
    return { name: el.textContent, left, top, right: left! + width!, bottom: top! + height! }
  })

const named = (): (string | null)[] => nameBoxes().map((one) => one.name)

const clashOf = (boxes: ReturnType<typeof nameBoxes>): boolean =>
  boxes.some((a, i) =>
    boxes.some(
      (b, j) =>
        i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    )
  )

/** Runs every frame asked for, 40 ms on, as the WebView does. */
const tick = (count: number): void => {
  for (let at = 0; at < count; at++) {
    const due = [...frames.values()]
    frames.clear()
    for (const cb of due) {
      cb(performance.now() + at * 40)
    }
  }
}

const pixelStage = (engine: TeamSceneEngine): Promise<void> =>
  engine.receive({
    kind: 'stage',
    stage: {
      art: { kind: 'pixel', sceneId: 'quest' },
      images: {},
      scenes: [],
      timezone: 'UTC',
      nowMs: 0,
      colors: COLORS
    }
  })

/** Each sprite's left and right edge in stage px: Pixel moves to it, flips by scale, then draws at 0, 0. */
const spriteSpans = (drawn: readonly Call[]): [number, number][] => {
  let x = 0
  let flip = 1
  return drawn.flatMap((one): [number, number][] => {
    if (one.name === 'translate') {
      x = Number(one.args[0])
    } else if (one.name === 'scale') {
      flip = Number(one.args[0])
    }
    if (one.name !== 'drawImage' || one.args.length !== 3) {
      return []
    }
    const right = x + (one.args[0] as { width: number }).width * flip
    return [[Math.min(x, right), Math.max(x, right)]]
  })
}

/** Runs the scene for `seconds` at 30 frames a second, as the frame loop drives it. */
const run = (engine: TeamSceneEngine, seconds: number): void => {
  for (let at = 0; at < seconds * 30; at++) {
    engine.paint(1 / 30)
  }
}

describe('the phone scene engine', () => {
  it('tells the sheet how tall the stage and its names are once its art is ready', async () => {
    const { engine, events } = mount()
    await officeStage(engine)
    expect(events).toEqual([{ kind: 'ready', height: 176 + TEAM_SCENE_NAME_STRIP }])
  })

  it('walks a member who joins to its desk and seats it working, as the desktop office does', async () => {
    const { engine } = mount()
    await officeStage(engine)
    engine.receive({
      kind: 'input',
      input: inputOf([member('m2', 'Wario', 'resting')]),
      leadLine: null
    })
    run(engine, 1)
    engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'working'), member('m2', 'Wario', 'resting')]),
      leadLine: null
    })
    run(engine, 0.5)
    const early = engine.actors().find((one) => one.key === 'm1')
    run(engine, 20)
    const seated = engine.actors().find((one) => one.key === 'm1')
    expect(early?.pose).toBe('walk')
    expect(seated?.pose).toBe('work')
    expect(engine.stations().some((spot) => Math.abs(spot.x - seated!.x) < 0.01)).toBe(true)
    expect(engine.actors().find((one) => one.key === 'm2')?.pose).not.toBe('work')
  })

  it('changes a member pose with its state: waiting raises an alert, done stands finished', async () => {
    const { engine } = mount()
    await officeStage(engine)
    engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'working')]),
      leadLine: null
    })
    run(engine, 20)
    engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'needsYou')]),
      leadLine: null
    })
    run(engine, 1)
    expect(engine.actors().find((one) => one.key === 'm1')?.emote).toBe('alert')
    engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'done')]),
      leadLine: null
    })
    run(engine, 20)
    expect(engine.actors().find((one) => one.key === 'm1')?.pose).toBe('done')
  })

  it("draws the office's desks and every figure's name", async () => {
    const { engine } = mount()
    await officeStage(engine)
    engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'working')]),
      leadLine: null
    })
    calls = []
    run(engine, 1)
    const drawn = calls
      .filter((one) => one.name === 'drawImage')
      .map((one) => (one.args[0] as Partial<Bitmap>).src)
    expect(drawn).toContain('office/desk.png')
    expect(named()).toEqual(expect.arrayContaining(['Alfred', 'Toadette']))
  })

  it("never lets a walker's name cover the name of a member at its desk", async () => {
    const { engine } = mount()
    await officeStage(engine)
    const seated = ['Toadette', 'Wario', 'Peach'].map((name, at) =>
      member(`m${at}`, name, 'working')
    )
    engine.receive({ kind: 'input', input: inputOf(seated), leadLine: null })
    run(engine, 2)
    engine.receive({
      kind: 'input',
      input: inputOf([...seated, member('m9', 'Mario', 'working')]),
      leadLine: null
    })
    for (let frame = 0; frame < 90; frame++) {
      engine.paint(1 / 30)
      expect(clashOf(nameBoxes()), `frame ${frame}`).toBe(false)
    }
  })

  it('names every member at its desk on a 320 pt phone, where the desks sit closer than a name', async () => {
    const { engine } = mount(320)
    await officeStage(engine)
    const names = ['Toadette', 'Wario', 'Peach', 'Rosalina']
    engine.receive({
      kind: 'input',
      input: inputOf(names.map((name, at) => member(`m${at}`, name, 'working'))),
      leadLine: null
    })
    run(engine, 2)
    expect(named()).toEqual(expect.arrayContaining(names))
  })

  it('names all six desks of a 390 pt team, the advisor and the lead, as on the live host', async () => {
    const { engine } = mount(390)
    await officeStage(engine)
    const names = ['Peach', 'Rosalina', 'Wario', 'Mario', 'Donkey Kong', 'Donkey Kong']
    const activities = ['needsYou', 'working', 'working', 'done', 'done', 'done'] as const
    engine.receive({
      kind: 'input',
      input: {
        ...inputOf(names.map((name, at) => member(`m${at}`, name, activities[at]))),
        advisor: { line: null }
      },
      leadLine: null
    })
    run(engine, 20)
    expect(nameBoxes()).toHaveLength(names.length + 2)
    expect(named()).toEqual(expect.arrayContaining([...names, 'Alfred']))
    expect(clashOf(nameBoxes())).toBe(false)
  })

  it("names the advisor in the strip as the advisor's card does", async () => {
    const { engine } = mount()
    await pixelStage(engine)
    await engine.receive({
      kind: 'input',
      input: { ...inputOf([member('m1', 'Toadette', 'working')]), advisor: { line: null } },
      leadLine: null,
      advisorName: 'Mago'
    })
    run(engine, 1)
    expect(named()).toEqual(expect.arrayContaining(['Alfred', 'Toadette', 'Mago']))
    expect(named()).not.toContain('advisor')
  })

  it('keeps every figure whole on a 320 pt stage while the first desk fetches or strolls', async () => {
    for (const activity of ['working', 'resting'] as const) {
      const { engine } = mount(320)
      await pixelStage(engine)
      await engine.receive({
        kind: 'input',
        input: {
          ...inputOf(
            ['Mario', 'Arthur', 'Rosalina'].map((name, at) => member(`m${at}`, name, activity))
          ),
          advisor: { line: null }
        },
        leadLine: null,
        advisorName: 'Mago'
      })
      const spans: [number, number][] = []
      for (let frame = 0; frame < 30 * 30; frame++) {
        calls = []
        engine.paint(1 / 30)
        spans.push(...spriteSpans(calls))
      }
      expect(spans.length).toBeGreaterThan(0)
      expect(
        spans.filter(([left, right]) => left < 0 || right > 320),
        activity
      ).toEqual([])
      engine.dispose()
    }
  })

  it("puts the lead's line in a bubble over the stage", async () => {
    const { engine } = mount()
    await officeStage(engine)
    engine.receive({ kind: 'input', input: inputOf([]), leadLine: 'Reviewing #1249' })
    run(engine, 1)
    expect(document.querySelector('[data-scene-bubble="lead"]')?.textContent).toBe(
      'Reviewing #1249'
    )
  })

  it('draws the Pixel stage the desktop draws for that style', async () => {
    const { engine, events } = mount()
    await engine.receive({
      kind: 'stage',
      stage: {
        art: { kind: 'pixel', sceneId: 'quest' },
        images: {},
        scenes: [],
        timezone: 'UTC',
        nowMs: 0,
        colors: COLORS
      }
    })
    engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'working')]),
      leadLine: null
    })
    run(engine, 1)
    expect(events[0]).toMatchObject({ kind: 'ready' })
    expect(named()).toContain('Toadette')
  })

  it('says when the art does not load, so the sheet draws the fallback stage', async () => {
    const { engine, events } = mount()
    await engine.receive({
      kind: 'stage',
      stage: {
        art: { kind: 'bundled', style: 'office' },
        images: {},
        scenes: [],
        timezone: 'UTC',
        nowMs: 0,
        colors: COLORS
      }
    })
    expect(events).toEqual([{ kind: 'artFailed' }])
  })

  it('stops its frames after a paint throws and says so once, so the sheet can fall back', async () => {
    const { engine, events } = mount()
    await pixelStage(engine)
    await engine.receive({ kind: 'input', input: inputOf([]), leadLine: null })
    tick(3)
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
      throw new Error('canvas lost')
    })
    expect(() => tick(30)).not.toThrow()
    expect(events.filter((one) => one.kind === 'error')).toEqual([
      { kind: 'error', message: 'Error: canvas lost' }
    ])
    expect(frames.size).toBe(0)
  })

  it('runs no frames while nobody sees the band, and picks up when someone does', async () => {
    const { engine } = mount()
    await engine.receive({ kind: 'motion', run: false, reduced: false })
    await pixelStage(engine)
    await engine.receive({ kind: 'input', input: inputOf([]), leadLine: null })
    expect(frames.size).toBe(0)
    await engine.receive({ kind: 'motion', run: true, reduced: false })
    expect(frames.size).toBe(1)
    await engine.receive({ kind: 'motion', run: false, reduced: false })
    expect(frames.size).toBe(0)
  })

  it("settles the stage and paints it once, with no frames, under the phone's Reduce Motion", async () => {
    const { engine } = mount()
    await pixelStage(engine)
    await engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'working')]),
      leadLine: null
    })
    expect(frames.size).toBe(1)
    calls = []
    await engine.receive({ kind: 'motion', run: true, reduced: true })
    expect(frames.size).toBe(0)
    expect(engine.actors().find((one) => one.key === 'm1')?.pose).toBe('work')
    expect(calls.some((one) => one.name === 'drawImage' || one.name === 'fillRect')).toBe(true)
    expect(named()).toContain('Toadette')
  })

  it('paints no still frame under Reduce Motion while nobody sees the band, and one when someone does', async () => {
    const { engine } = mount()
    const painted = () => calls.some((one) => one.name === 'drawImage' || one.name === 'fillRect')
    await engine.receive({ kind: 'motion', run: false, reduced: true })
    await pixelStage(engine)
    calls = []
    await engine.receive({
      kind: 'input',
      input: inputOf([member('m1', 'Toadette', 'working')]),
      leadLine: null
    })
    expect(frames.size).toBe(0)
    expect(painted()).toBe(false)
    await engine.receive({ kind: 'motion', run: true, reduced: true })
    expect(frames.size).toBe(0)
    expect(painted()).toBe(true)
  })

  it("sizes the canvas to its stage's height, as the desktop does, also when the style changes", async () => {
    const { engine } = mount()
    const canvas = document.querySelector('canvas')!
    await officeStage(engine)
    await engine.receive({ kind: 'input', input: inputOf([]), leadLine: null })
    engine.paint(1 / 30)
    expect([canvas.style.height, canvas.height]).toEqual(['176px', 176])
    await pixelStage(engine)
    engine.paint(1 / 30)
    expect([canvas.style.height, canvas.height]).toEqual(['126px', 126])
  })

  it('names every figure in a strip under the stage at 320, no two labels touching and none past the band', async () => {
    const { engine, events } = mount(320)
    await pixelStage(engine)
    const names = ['Toadette', 'Wario', 'Bartholomew Montgomery-Smythe', 'Peach']
    const team = (count: number): TeamSceneInput => ({
      ...inputOf(names.slice(0, count).map((name, at) => member(`m${at}`, name, 'working'))),
      advisor: { line: null }
    })
    await engine.receive({ kind: 'input', input: team(2), leadLine: null })
    run(engine, 1)
    await engine.receive({ kind: 'input', input: team(4), leadLine: null })
    const ready = events.find((one) => one.kind === 'ready') as { height: number }
    const strip = ready.height - 126
    expect(strip).toBeGreaterThan(0)
    // Why every frame: two members walk to their seats past the others' names.
    for (let frame = 0; frame < 120; frame++) {
      calls = []
      engine.paint(1 / 30)
      const boxes = nameBoxes()
      expect(boxes, `frame ${frame}`).toHaveLength(6)
      expect(boxes.map((one) => one.name)).toEqual(expect.arrayContaining(['Alfred', ...names]))
      for (const one of boxes) {
        expect(one.left, `frame ${frame} ${one.name}`).toBeGreaterThanOrEqual(0)
        expect(one.right, `frame ${frame} ${one.name}`).toBeLessThanOrEqual(320)
        expect(one.top, `frame ${frame} ${one.name}`).toBeGreaterThanOrEqual(0)
        expect(one.bottom, `frame ${frame} ${one.name}`).toBeLessThanOrEqual(strip)
        // Why 20: room for a letter and the ellipsis, so every figure keeps a name.
        expect(one.right - one.left, `frame ${frame} ${one.name}`).toBeGreaterThanOrEqual(20)
      }
      expect(clashOf(boxes), `frame ${frame}`).toBe(false)
      // Why: the art stays the desktop's; no name is painted over a figure.
      const painted = calls.filter((one) => one.name === 'fillText').map((one) => one.args[0])
      expect(painted.filter((text) => names.includes(String(text)))).toEqual([])
    }
  })
})
