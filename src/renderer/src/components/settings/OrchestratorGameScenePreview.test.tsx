// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PluginHostListEntry } from '../../../../preload/api/plugin-host-api'
import type { OrchestratorGameMode } from '../../../../shared/orchestrator-game-config'
import { usePluginPanelsStore } from '../../store/plugin-panels'
import { OrchestratorGameScenePreview } from './OrchestratorGameScenePreview'
import { PREVIEW_TICK_MS } from './orchestrator-game-scene-preview-frame'

const spacePack: PluginHostListEntry = {
  pluginKey: 'acme.space',
  consentFingerprint: 'sha256-x',
  name: 'Space Pack',
  version: '1.0.0',
  publisher: 'acme',
  status: 'idle',
  needsReconsent: false,
  isDev: false,
  official: false,
  bundled: false,
  capabilities: [],
  panels: [],
  commands: [],
  hasWorker: false,
  restarts: 0,
  gameScenes: ['acme.space/orbit']
}

type HappyDomSettings = {
  happyDOM: { settings: { device: { prefersReducedMotion: 'reduce' | 'no-preference' } } }
}
const isHappyDom = (target: object): target is HappyDomSettings => 'happyDOM' in target
const setReducedMotion = (reduce: boolean): void => {
  if (!isHappyDom(window)) {
    throw new Error('this suite needs the happy-dom environment')
  }
  window.happyDOM.settings.device.prefersReducedMotion = reduce ? 'reduce' : 'no-preference'
}

let container: HTMLDivElement
let root: Root

const show = (scene: string, mode: OrchestratorGameMode): void => {
  act(() => {
    root.render(<OrchestratorGameScenePreview scene={scene} mode={mode} />)
  })
}

const figure = (): HTMLElement => {
  const element = container.querySelector<HTMLElement>('[data-slot="game-scene-preview"]')
  expect(element).toBeTruthy()
  return element as HTMLElement
}

const wait = (ms: number): Promise<void> =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

beforeEach(() => {
  usePluginPanelsStore.setState({ plugins: [spacePack], fetchStatus: 'ready' })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setReducedMotion(false)
})

describe('OrchestratorGameScenePreview', () => {
  it('draws the picked scene and follows a new pick', () => {
    show('quest', 'on')
    expect(figure().dataset.scene).toBe('quest')
    expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe(
      'Preview of Quest (built-in)'
    )
    expect(figure().textContent).toContain('Squire')

    show('vigilante', 'on')
    expect(figure().dataset.scene).toBe('vigilante')
    expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe(
      'Preview of Night Watch (built-in)'
    )
    expect(figure().textContent).toContain('Night Watch')
  })

  it('follows the mode: zen notes what it hides, off draws nothing', () => {
    show('quest', 'zen')
    expect(figure().dataset.mode).toBe('zen')
    expect(figure().textContent).toContain('also hides short working notes')

    show('quest', 'off')
    expect(figure().dataset.mode).toBe('off')
    expect(container.querySelector('canvas')).toBeNull()
    expect(figure().textContent).toContain('start as plain Claude')
  })

  it('draws quest for a scene nothing installed serves and says why', () => {
    show('acme.gone/orbit', 'on')
    expect(figure().dataset.scene).toBe('quest')
    expect(figure().textContent).toContain('Not installed, so the game draws Quest.')
  })

  it('says a plugin scene is only drawn in the pane', () => {
    show('acme.space/orbit', 'on')
    expect(container.querySelector('canvas')).toBeNull()
    expect(figure().textContent).toContain('only drawn inside an Agent Teams pane')
  })

  // Why a class check: happy-dom lays nothing out; the e2e spec measures the canvas at 320 and 390px.
  it('scales the canvas to its column and never past the window', () => {
    show('quest', 'on')
    const canvas = container.querySelector('canvas')
    expect(canvas?.classList.contains('w-full')).toBe(true)
    expect(canvas?.classList.contains('h-auto')).toBe(true)
    expect(canvas?.classList.contains('max-w-[min(512px,calc(100vw-2rem))]')).toBe(true)
  })

  it('animates at the mod tick', async () => {
    show('quest', 'on')
    expect(figure().dataset.animated).toBe('true')
    await wait(PREVIEW_TICK_MS * 3)
    expect(Number(figure().dataset.tick)).toBeGreaterThan(0)
  })

  it('holds a still frame under reduced motion', async () => {
    setReducedMotion(true)
    show('quest', 'on')
    expect(figure().dataset.animated).toBe('false')
    await wait(PREVIEW_TICK_MS * 3)
    expect(figure().dataset.tick).toBe('0')
  })
})
