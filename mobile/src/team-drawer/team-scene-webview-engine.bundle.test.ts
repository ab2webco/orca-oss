import { createContext, runInContext, type Context } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import type { TeamSceneEngineMessage } from './team-scene-engine-messages'
import { TEAM_SCENE_ENGINE_JS } from './team-scene-webview-engine.generated'

// Why: an old Android System WebView lacks these; the page must still draw on it.
const STRIP_NEWER_BUILT_INS = `
  delete Array.prototype.toSorted; delete Array.prototype.toReversed; delete Array.prototype.findLast;
  delete Array.prototype.findLastIndex; delete Array.prototype.at;
  delete Object.hasOwn; delete String.prototype.replaceAll;
`

type Page = {
  realm: Context
  posted: { kind: string; [key: string]: unknown }[]
  /** What the page's canvas painted as text; names belong in the strip, not here. */
  drawn: string[]
  /** The name labels the page put in its strip. */
  named: () => string[]
  stage: { width: number; style: { height?: string } }
  /** Uncaught throws out of a frame, as the WebView would report each one. */
  thrown: string[]
  /** The frames asked for and not yet run or cancelled, by id. */
  frames: Map<number, (now: number) => void>
  breakCanvas: () => void
  send: (message: TeamSceneEngineMessage) => Promise<void>
  flush: (count: number) => void
}

/** A WebView page with no canvas behind it: the 2D context records text and draws nothing. */
function loadPage(strip: boolean, opts: { threeD?: { style: { display?: string } } } = {}): Page {
  const posted: Page['posted'] = []
  const drawn: string[] = []
  const thrown: string[] = []
  const frames: Page['frames'] = new Map()
  let frameId = 0
  let broken = false
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (own, key) =>
      key in own
        ? own[key]
        : (...args: unknown[]) => {
            if (broken) {
              throw new Error('canvas lost')
            }
            if (key === 'fillText') {
              drawn.push(String(args[0]))
            }
            return { width: 8, addColorStop: () => undefined }
          },
    set: (own, key, value) => {
      own[key] = value
      return true
    }
  })
  const created: { textContent?: string; dataset: { sceneName?: string } }[] = []
  const element = () => ({
    style: {},
    dataset: {},
    offsetWidth: 120,
    offsetHeight: 30,
    width: 0,
    height: 0,
    getContext: () => context,
    appendChild: () => undefined,
    remove: () => undefined
  })
  const createElement = () => {
    const one = element()
    created.push(one)
    return one
  }
  const stage = { ...element(), clientWidth: 390 }
  const realm = createContext({
    devicePixelRatio: 3,
    ReactNativeWebView: { postMessage: (data: string) => posted.push(JSON.parse(data)) },
    addEventListener: () => undefined,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (cb: (now: number) => void) => {
      frameId += 1
      frames.set(frameId, cb)
      return frameId
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    CanvasRenderingContext2D: function CanvasRenderingContext2D() {},
    Image: function Image() {},
    document: {
      getElementById: (id: string) =>
        id === 'stage'
          ? stage
          : id === 'overlay' || id === 'names'
            ? element()
            : id === 'stage3d' && opts.threeD
              ? { ...opts.threeD, getContext: () => null }
              : null,
      createElement
    }
  })
  runInContext('var window = globalThis', realm)
  if (strip) {
    runInContext(STRIP_NEWER_BUILT_INS, realm)
  }
  runInContext(TEAM_SCENE_ENGINE_JS, realm)
  let now = 0
  return {
    realm,
    posted,
    drawn,
    named: () => created.flatMap((one) => (one.dataset.sceneName ? [one.textContent ?? ''] : [])),
    stage,
    thrown,
    frames,
    breakCanvas: () => {
      broken = true
    },
    send: async (message) => {
      runInContext(`window.__teamScene(${JSON.stringify(message)})`, realm)
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    flush: (count) => {
      for (let at = 0; at < count; at++) {
        now += 40
        const due = [...frames.values()]
        frames.clear()
        for (const cb of due) {
          try {
            cb(now)
          } catch (error) {
            thrown.push(String(error))
          }
        }
      }
    }
  }
}

const input: TeamSceneInput = {
  lead: { key: 'lead', name: 'Peach', characterKey: null, activity: 'working' },
  advisor: { line: 'Jev: approve the merge' },
  members: ['Mario', 'Luigi', 'Daisy'].map((name, at) => ({
    key: name,
    name,
    characterKey: null,
    activity: at === 0 ? 'needsYou' : 'working',
    reportId: null,
    mergedPr: null,
    site: { stage: 1, broken: false }
  }))
}

async function pixelStage(page: Page): Promise<void> {
  await page.send({
    kind: 'stage',
    stage: {
      art: { kind: 'pixel', sceneId: 'quest' },
      images: {},
      scenes: [],
      timezone: 'America/Bogota',
      nowMs: Date.UTC(2026, 10, 16, 3, 0),
      colors: { attention: '#f00', done: '#a0f', working: '#0f0', risk: '#fa0' }
    }
  })
  await page.send({ kind: 'input', input, leadLine: 'Merging #7' })
}

// Each runs in the page and its result is compared, as JSON, with what the built-in answers.
const SHIM_CASES = [
  `'a.b.c'.replaceAll('.', '$&$&')`,
  `'a.b'.replaceAll('.', '$$')`,
  `'a.b'.replaceAll('.', '$$&')`,
  "'x-y'.replaceAll('-', '[$`|$\\']')",
  `'a1a'.replaceAll('a', '$1$<n>$')`,
  `'abab'.replaceAll('b', (m, i, s) => m + i + s.length)`,
  `'aaa'.replaceAll('', '-')`,
  `'aXbx'.replaceAll(/x/gi, '[$&]')`,
  `(() => { try { return 'a'.replaceAll(/a/, 'b') } catch (e) { return e.name } })()`,
  `[1, 2, 3, 4].findLast(function (v) { return v < this.max }, { max: 3 })`,
  `[1, 2, 3, 4].findLastIndex(function (v) { return v < this.max }, { max: 3 })`,
  `[1, 2, 3, 4].findLast((v) => v > 9)`,
  `[1, 2, 3].findLastIndex((v, i, all) => all.length === 3 && i === 0)`,
  `[[1, 2, 3].at(-1), [1, 2, 3].at(5), [1, 2, 3].at(1.7), [1, 2, 3].at(-4)]`,
  `(() => { const a = [3, 1, 2]; return [a.toSorted(), a, a.toSorted((x, y) => y - x)] })()`,
  `(() => { const a = [3, 1, 2]; return [a.toReversed(), a, [].toReversed()] })()`,
  `[Object.hasOwn({ a: 1 }, 'a'), Object.hasOwn(Object.create({ a: 1 }), 'a')]`,
  `(() => { const keys = []; for (const k in []) keys.push(k); for (const k in '') keys.push(k); return keys })()`
]

const answersIn = (realm: Context): unknown[] =>
  SHIM_CASES.map((expression) => JSON.parse(runInContext(`JSON.stringify([${expression}])`, realm)))

describe('the Team scene WebView bundle', () => {
  it('draws a Pixel stage on a WebView without the newer built-ins', async () => {
    const page = loadPage(true)
    expect(page.posted).toEqual([{ kind: 'loaded' }])
    await pixelStage(page)
    page.flush(60)
    expect(page.thrown).toEqual([])
    expect(page.posted.map((one) => one.kind)).toEqual(['loaded', 'ready'])
    expect(page.stage.width).toBe(390 * 3)
    // Why: the band takes the page's height once ready; a canvas left taller is cut off there.
    expect(page.stage.style.height).toBe('126px')
    expect(page.named()).toEqual(expect.arrayContaining(['Peach', 'Mario', 'Luigi', 'Daisy']))
    expect(
      page.drawn.filter((text) => ['Peach', 'Mario', 'Luigi', 'Daisy'].includes(text))
    ).toEqual([])
  })

  it('answers as the built-ins do where it fills them in, and leaves present ones alone', () => {
    const stripped = loadPage(true)
    const native = createContext({})
    expect(answersIn(stripped.realm)).toEqual(answersIn(native))
    const builtIns = `[Array.prototype.at, Array.prototype.findLast, Array.prototype.findLastIndex,
      Array.prototype.toSorted, Array.prototype.toReversed, String.prototype.replaceAll, Object.hasOwn]`
    const kept = createContext({})
    runInContext(`var before = ${builtIns}`, kept)
    const page = loadPage(false)
    expect(runInContext(`${builtIns}.every((one, at) => one === before[at])`, kept)).toBe(true)
    expect(answersIn(page.realm)).toEqual(answersIn(native))
  })

  it('rounds the corners of a rect where the WebView has no roundRect', () => {
    const page = loadPage(true)
    const path = runInContext(
      `(() => {
        const calls = []
        const g = Object.create(CanvasRenderingContext2D.prototype)
        for (const name of ['moveTo', 'arcTo', 'closePath']) g[name] = (...args) => calls.push([name, ...args])
        g.roundRect(0, 0, 10, 20, 30)
        return JSON.stringify(calls)
      })()`,
      page.realm
    )
    // Why 5: a radius past half the shorter side shrinks to it, as the built-in scales it.
    expect(JSON.parse(path)).toEqual([
      ['moveTo', 5, 0],
      ['arcTo', 10, 0, 10, 20, 5],
      ['arcTo', 10, 20, 0, 20, 5],
      ['arcTo', 0, 20, 0, 0, 5],
      ['arcTo', 0, 0, 10, 0, 5],
      ['closePath'],
      ['moveTo', 0, 0]
    ])
  })

  // ORCA-1296: a phone WebView with no WebGL keeps drawing Figures in 2D when the host asks for 3D.
  it('keeps Figures in 2D where the 3D canvas gets no WebGL, and never breaks the page', async () => {
    const stage3d = { style: { display: 'none' } }
    const page = loadPage(true, { threeD: stage3d })
    await page.send({
      kind: 'stage',
      stage: {
        art: { kind: 'bundled', style: 'figures' },
        images: {},
        scenes: [],
        timezone: 'America/Bogota',
        nowMs: Date.UTC(2026, 10, 16, 3, 0),
        colors: { attention: '#f00', done: '#a0f', working: '#0f0', risk: '#fa0' },
        diorama: { quality: 'high', pace: 'normal' }
      }
    })
    await page.send({ kind: 'input', input, leadLine: null, advisorName: 'Jev', machines: [] })
    page.flush(10)
    expect(stage3d.style.display).toBe('none')
    expect(page.posted.filter((one) => one.kind === 'error')).toEqual([])
    expect(page.thrown).toEqual([])
  })

  // ORCA-1335: only a 3D stage has a camera; the 2D engine reads any other kind as a new stage.
  it('leaves a 2D stage alone when the sheet sends a camera move', async () => {
    const page = loadPage(true, { threeD: { style: { display: 'none' } } })
    await pixelStage(page)
    page.flush(5)
    await page.send({ kind: 'camera', mode: 'all' })
    await page.send({ kind: 'camera', pan: [12, -4], zoom: 1.5 })
    page.flush(5)
    expect(page.posted.map((one) => one.kind)).toEqual(['loaded', 'ready'])
    expect(page.thrown).toEqual([])
  })

  it('stops drawing after a paint throws, and says so once', async () => {
    const page = loadPage(true)
    await pixelStage(page)
    page.flush(5)
    page.breakCanvas()
    page.flush(30)
    expect(page.thrown).toEqual([])
    expect(page.posted.filter((one) => one.kind === 'error')).toEqual([
      { kind: 'error', message: 'Error: canvas lost' }
    ])
    expect(page.frames.size).toBe(0)
  })
})
