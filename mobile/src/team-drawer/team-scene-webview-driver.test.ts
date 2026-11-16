import { describe, expect, it, vi } from 'vitest'
import type {
  TeamSceneFrame,
  TeamScenePainter
} from '../../../src/renderer/src/components/team-scene/team-scene-painter'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import { createTeamSceneEngine, type TeamSceneEngineCanvas } from './team-scene-webview-driver'
import type {
  TeamSceneEngineCommand,
  TeamSceneEngineEvent,
  TeamSceneEngineSetup
} from './team-scene-webview-messages'

const setup: TeamSceneEngineSetup = {
  sceneId: 'quest',
  extension: null,
  timezone: 'UTC',
  colors: { attention: '#f00', done: '#a0f', working: '#0f0', risk: '#fa0' }
}

const member = (key: string): TeamSceneInput['members'][number] => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false }
})

const inputOf = (...members: string[]): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: null,
  members: members.map(member)
})

const sceneOf = (
  input: TeamSceneInput,
  over: Partial<Extract<TeamSceneEngineCommand, { type: 'scene' }>> = {}
): string => JSON.stringify({ type: 'scene', setup, input, reducedMotion: false, ...over })

function harness(options: { width?: number; paint?: (frame: TeamSceneFrame) => void } = {}) {
  const frames = new Map<number, (now: number) => void>()
  let nextId = 1
  let now = 0
  const painters: { painter: TeamScenePainter; frames: TeamSceneFrame[] }[] = []
  const events: TeamSceneEngineEvent[] = []
  const setTransform = vi.fn()
  // Why a cast: the driver only sets the transform; the painter, a fake here, draws the rest.
  const context = { setTransform } as unknown as CanvasRenderingContext2D
  const canvas: TeamSceneEngineCanvas = {
    width: 0,
    height: 0,
    clientWidth: options.width ?? 390,
    style: { height: '' },
    getContext: () => context
  }
  const makePainter = vi.fn((_setup: TeamSceneEngineSetup): TeamScenePainter => {
    const own: TeamSceneFrame[] = []
    const painter: TeamScenePainter = {
      height: 126,
      headTop: () => 0,
      paint: (_g, frame) => {
        options.paint?.(frame)
        own.push(frame)
      },
      dispose: vi.fn()
    }
    painters.push({ painter, frames: own })
    return painter
  })
  const engine = createTeamSceneEngine({
    canvas,
    ratio: () => 3,
    scheduler: {
      request: (cb) => {
        frames.set(nextId, cb)
        return nextId++
      },
      cancel: (id) => {
        frames.delete(id)
      }
    },
    post: (event) => events.push(event),
    makePainter
  })
  // Why 40 ms: past the frame loop's 30 fps gate, so every flush paints.
  const flush = (count = 1): void => {
    for (let i = 0; i < count; i++) {
      now += 40
      const pending = [...frames.entries()]
      frames.clear()
      pending.forEach(([, cb]) => cb(now))
    }
  }
  return { engine, canvas, painters, events, makePainter, frames, flush, setTransform }
}

describe('createTeamSceneEngine', () => {
  it('builds the painter from the first scene and paints the director’s actors each frame', () => {
    const h = harness()
    h.engine.receive(sceneOf(inputOf('pane-1', 'pane-2')))
    h.flush(3)

    expect(h.makePainter).toHaveBeenCalledWith(setup)
    expect(h.canvas.width).toBe(390 * 3)
    expect(h.canvas.height).toBe(126 * 3)
    expect(h.canvas.style.height).toBe('126px')
    expect(h.setTransform).toHaveBeenCalledWith(3, 0, 0, 3, 0, 0)
    const painted = h.painters[0]!.frames
    expect(painted.length).toBeGreaterThan(0)
    expect(painted.at(-1)!.width).toBe(390)
    expect(
      painted
        .at(-1)!
        .actors.map((a) => a.key)
        .sort()
    ).toEqual(['lead', 'pane-1', 'pane-2'])
    expect(h.events).toEqual([{ type: 'drawn', height: 126 }])
  })

  it('keeps the painter for a new team on the same setup', () => {
    const h = harness()
    h.engine.receive(sceneOf(inputOf('pane-1')))
    h.flush(2)
    h.engine.receive(sceneOf(inputOf('pane-1', 'pane-3')))
    h.flush(2)

    expect(h.makePainter).toHaveBeenCalledTimes(1)
    expect(h.painters[0]!.painter.dispose).not.toHaveBeenCalled()
    expect(h.painters[0]!.frames.at(-1)!.actors.map((a) => a.key)).toContain('pane-3')
  })

  it('disposes the painter and builds another when the setup changes', () => {
    const h = harness()
    h.engine.receive(sceneOf(inputOf('pane-1')))
    h.flush()
    const changed = { ...setup, colors: { ...setup.colors, working: '#00f' } }
    h.engine.receive(sceneOf(inputOf('pane-1'), { setup: changed }))
    h.flush()

    expect(h.makePainter).toHaveBeenCalledTimes(2)
    expect(h.makePainter).toHaveBeenLastCalledWith(changed)
    expect(h.painters[0]!.painter.dispose).toHaveBeenCalledTimes(1)
    expect(h.painters[1]!.frames.length).toBeGreaterThan(0)
  })

  it('under reduced motion paints the settled scene once per command and on resize, with no frames', () => {
    const h = harness()
    h.engine.receive(sceneOf(inputOf('pane-1'), { reducedMotion: true }))

    expect(h.frames.size).toBe(0)
    expect(h.painters[0]!.frames).toHaveLength(1)
    h.engine.resize()
    expect(h.painters[0]!.frames).toHaveLength(2)
    expect(h.events).toEqual([{ type: 'drawn', height: 126 }])
  })

  it('stops frames on run false and resumes on run true', () => {
    const h = harness()
    h.engine.receive(sceneOf(inputOf('pane-1')))
    h.engine.receive('{"type":"run","running":false}')
    expect(h.frames.size).toBe(0)

    h.engine.receive('{"type":"run","running":true}')
    h.flush(2)
    expect(h.painters[0]!.frames.length).toBeGreaterThan(0)
  })

  it('a resize under full motion waits for the next frame', () => {
    const h = harness()
    h.engine.receive(sceneOf(inputOf('pane-1')))
    h.engine.resize()
    expect(h.painters[0]!.frames).toHaveLength(0)
  })

  it('posts the paint error once, stops frames and ignores later scenes', () => {
    const h = harness({
      paint: () => {
        throw new Error('no sprite')
      }
    })
    h.engine.receive(sceneOf(inputOf('pane-1')))
    h.flush(3)
    h.engine.receive(sceneOf(inputOf('pane-2')))
    h.flush(2)

    expect(h.events).toEqual([{ type: 'error', message: 'no sprite' }])
    expect(h.frames.size).toBe(0)
    expect(h.makePainter).toHaveBeenCalledTimes(1)
  })

  it('posts an error for a command it cannot read', () => {
    const h = harness()
    h.engine.receive('{"type":"paint"}')
    expect(h.events).toEqual([{ type: 'error', message: 'Unreadable scene command' }])
  })

  it('draws nothing while the canvas has no width yet', () => {
    const h = harness({ width: 0 })
    h.engine.receive(sceneOf(inputOf('pane-1')))
    h.flush(2)
    expect(h.painters[0]!.frames).toHaveLength(0)
    expect(h.events).toEqual([])
  })

  it('dispose stops frames and drops the painter', () => {
    const h = harness()
    h.engine.receive(sceneOf(inputOf('pane-1')))
    h.engine.dispose()
    expect(h.frames.size).toBe(0)
    expect(h.painters[0]!.painter.dispose).toHaveBeenCalledTimes(1)
  })
})
