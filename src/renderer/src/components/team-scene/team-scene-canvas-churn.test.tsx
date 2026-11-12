// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOON } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import { orchestratorGameSceneArtFiles } from '../../../../shared/orchestrator-game-scene-native'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { createImagePainter, type TeamSceneArtImage } from './team-scene-image-painter'
import type { TeamScenePainter } from './team-scene-painter'
import { createPixelPainter } from './team-scene-pixel-painter'
import { teamSceneQuestArtOf } from './team-scene-quest-art'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }
const member = (key: string, activity: 'working' | 'needsYou') =>
  ({
    key,
    name: key,
    characterKey: null,
    activity,
    reportId: null,
    mergedPr: null,
    site: { stage: 1, broken: false }
  }) as const
const INPUT: TeamSceneInput = {
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: { line: null },
  members: [member('a', 'working'), member('b', 'working'), member('c', 'needsYou')]
}

const imagePainter = (style: 'figures' | 'office'): TeamScenePainter => {
  const art = teamSceneQuestArtOf(style)
  const images = new Map(
    orchestratorGameSceneArtFiles({ figures: art }).map((src): [string, TeamSceneArtImage] => [
      src,
      { width: 256, height: 256, close() {} } as unknown as TeamSceneArtImage
    ])
  )
  return createImagePainter({
    art: { style: art, images },
    colors: COLORS,
    builds: style === 'figures' ? 'castle' : 'office'
  })
}

// Why a stub that answers everything: the count, not the pixels, is what this checks.
const context = new Proxy(
  {},
  {
    get: (_t, prop) =>
      prop === 'measureText'
        ? () => ({ width: 10 })
        : prop === 'getImageData'
          ? (_x: number, _y: number, w: number, h: number) => ({
              data: new Uint8ClampedArray(w * h * 4)
            })
          : prop === 'createLinearGradient' || prop === 'createRadialGradient'
            ? () => ({ addColorStop() {} })
            : () => undefined,
    set: () => true
  }
) as CanvasRenderingContext2D

let root: Root
let host: HTMLDivElement
let canvases = 0

beforeEach(() => {
  canvases = 0
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {}
      }) as unknown as MediaQueryList
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  const make = document.createElement.bind(document)
  const counting = (tag: string, options?: ElementCreationOptions): HTMLElement => {
    if (tag === 'canvas') {
      canvases += 1
    }
    return make(tag, options)
  }
  vi.spyOn(document, 'createElement').mockImplementation(counting as typeof document.createElement)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

/** Canvases a painter creates over a second minute of frames, once every pose has been cached. */
function canvasesAfterWarmup(painter: TeamScenePainter): number {
  let next: FrameRequestCallback | null = null
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    next = cb
    return 1
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  act(() => root.render(<TeamSceneCanvas input={INPUT} painter={painter} leadLine="Busy" />))
  let now = 0
  const run = (frames: number): void => {
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60
      act(() => next?.(now))
    }
  }
  run(60 * 60)
  const before = canvases
  run(60 * 60)
  return canvases - before
}

// Why: Blink memory grew ~120 MB/min in rc-preview while the JS heap stayed flat (2026-11-11), the
// mark of canvases made per frame that the collector is in no hurry to free.
describe('team scene canvases', () => {
  it.each(['figures', 'office'] as const)(
    'the %s painter makes no canvas per frame once warm',
    (style) => {
      expect(canvasesAfterWarmup(imagePainter(style))).toBe(0)
    }
  )

  it('the Pixel painter makes no canvas per frame once warm', () => {
    const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
    expect(canvasesAfterWarmup(painter)).toBe(0)
  })
})
