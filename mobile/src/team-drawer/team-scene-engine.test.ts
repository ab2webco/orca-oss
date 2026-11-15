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
let frames: ((now: number) => void)[] = []

beforeEach(() => {
  calls = []
  frames = []
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

function mount(): { engine: TeamSceneEngine; events: TeamSceneEngineEvent[] } {
  const stage = document.createElement('div')
  const canvas = document.createElement('canvas')
  stage.appendChild(canvas)
  document.body.replaceChildren(stage)
  const events: TeamSceneEngineEvent[] = []
  const engine = createTeamSceneEngine({
    canvas,
    overlay: stage,
    width: () => 390,
    ratio: () => 1,
    reducedMotion: false,
    scheduler: {
      request: (cb) => frames.push(cb),
      cancel: () => {}
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

/** Runs the scene for `seconds` at 30 frames a second, as the frame loop drives it. */
const run = (engine: TeamSceneEngine, seconds: number): void => {
  for (let at = 0; at < seconds * 30; at++) {
    engine.paint(1 / 30)
  }
}

describe('the phone scene engine', () => {
  it('tells the sheet how tall the stage is once its art is ready', async () => {
    const { engine, events } = mount()
    await officeStage(engine)
    expect(events).toEqual([{ kind: 'ready', height: 176 }])
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
    const names = calls.filter((one) => one.name === 'fillText').map((one) => one.args[0])
    expect(names).toEqual(expect.arrayContaining(['Alfred', 'Toadette']))
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
    expect(calls.filter((one) => one.name === 'fillText').map((one) => one.args[0])).toContain(
      'Toadette'
    )
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
})
