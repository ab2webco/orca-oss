import { createContext, runInContext } from 'node:vm'
import { parse } from 'acorn'
import { describe, expect, it } from 'vitest'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import { TEAM_SCENE_ENGINE_JS } from './team-scene-webview-engine.generated'
import {
  TEAM_SCENE_CANVAS_ID,
  teamSceneEngineEventOf,
  type TeamSceneEngineCommand,
  type TeamSceneEngineEvent
} from './team-scene-webview-messages'

// What an old Android System WebView or an iOS 15 WKWebView lacks of what the painter calls.
const STRIP_NEWER_BUILTINS = `
  delete Array.prototype.toSorted
  delete Array.prototype.findLast
  delete Array.prototype.findLastIndex
  delete Array.prototype.at
  delete Object.hasOwn
  delete String.prototype.replaceAll
`

// Why a proxy: the painter uses most of the 2D API; every call is a no-op that counts.
function fakeContext(counter: { calls: number }): object {
  const result = { width: 8, addColorStop: () => undefined }
  return new Proxy<Record<string | symbol, unknown>>(
    {},
    {
      get: (own, key) =>
        key in own
          ? own[key]
          : () => {
              counter.calls++
              return result
            },
      set: (own, key, value) => {
        own[key] = value
        return true
      }
    }
  )
}

function webView(options: { strip: boolean }) {
  const counter = { calls: 0 }
  const listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()
  const listen = (type: string, cb: (event: { data?: unknown }) => void): void => {
    listeners.set(type, [...(listeners.get(type) ?? []), cb])
  }
  const frames: ((now: number) => void)[] = []
  const posted: TeamSceneEngineEvent[] = []
  const canvasOf = () => ({
    width: 0,
    height: 0,
    clientWidth: 390,
    style: { height: '' },
    getContext: () => fakeContext(counter)
  })
  const stage = canvasOf()
  const context = createContext({
    devicePixelRatio: 3,
    ReactNativeWebView: {
      postMessage: (data: string) => {
        const event = teamSceneEngineEventOf(data)
        if (event) {
          posted.push(event)
        }
      }
    },
    addEventListener: listen,
    requestAnimationFrame: (cb: (now: number) => void) => frames.push(cb),
    cancelAnimationFrame: () => undefined,
    document: {
      addEventListener: listen,
      getElementById: (id: string) => (id === TEAM_SCENE_CANVAS_ID ? stage : null),
      createElement: canvasOf
    }
  })
  runInContext('var window = globalThis', context)
  if (options.strip) {
    runInContext(STRIP_NEWER_BUILTINS, context)
  }
  runInContext(TEAM_SCENE_ENGINE_JS, context)
  let now = 0
  return {
    posted,
    stage,
    counter,
    // Why on window: that is where iOS delivers the app's postMessage.
    send: (command: TeamSceneEngineCommand) =>
      listeners.get('message')?.forEach((cb) => cb({ data: JSON.stringify(command) })),
    flush: (count: number) => {
      for (let i = 0; i < count; i++) {
        now += 40
        frames.splice(0).forEach((cb) => cb(now))
      }
    }
  }
}

const member = (
  key: string,
  over: Partial<TeamSceneInput['members'][number]> = {}
): TeamSceneInput['members'][number] => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false },
  ...over
})

// Why this team: an asking member and Jev decisions walk the seat and event paths too.
const scene: TeamSceneEngineCommand = {
  type: 'scene',
  setup: {
    sceneId: 'quest',
    extension: null,
    timezone: 'America/Bogota',
    colors: { attention: '#f00', done: '#a0f', working: '#0f0', risk: '#fa0' }
  },
  input: {
    lead: { key: 'lead', name: 'Peach', characterKey: null, activity: 'working' },
    advisor: { line: null },
    members: [
      member('Mario', { activity: 'needsYou', paneAsk: true }),
      member('Luigi', {
        decisions: [{ id: 'd1', verdict: 'allow', gesture: 'approved' }],
        ci: 'pending'
      }),
      member('Daisy', { activity: 'done', mergedPr: 7, site: { stage: 3, broken: false } })
    ]
  },
  reducedMotion: false
}

describe('Team scene WebView engine', () => {
  it('parses at the chrome74 floor and loads nothing from the network', () => {
    expect(() => parse(TEAM_SCENE_ENGINE_JS, { ecmaVersion: 2019 })).not.toThrow()
    expect(TEAM_SCENE_ENGINE_JS).not.toMatch(/https?:\/\//)
    expect(TEAM_SCENE_ENGINE_JS).not.toMatch(/<\/script/i)
  })

  it('paints the Pixel scene in a WebView without the newer built-ins', () => {
    const view = webView({ strip: true })
    view.send(scene)
    view.flush(60)
    view.send({
      ...scene,
      input: { ...scene.input, members: [...scene.input.members, member('Toad')] }
    })
    view.flush(60)

    expect(view.posted).toEqual([{ type: 'ready' }, { type: 'drawn', height: 126 }])
    expect(view.stage.width).toBe(390 * 3)
    expect(view.counter.calls).toBeGreaterThan(1000)
  })
})
