// ORCA-692 POC: draws the game band with WebGL over the band rows of a terminal pane.
import type { Terminal } from '@xterm/xterm'
import { bandModelAt } from './band-demo-model'
import {
  initialBandModeOf,
  nextBandModeOf,
  webglClassOf,
  type BandMode,
  type BandWindow
} from './band-mode'
import { bandBoxOf, createOverlayDom } from './band-overlay-dom'
import { findBandRegion, type BandRegion } from './band-region'
import {
  AUTO_LIB,
  BAND_CHOICE_EVENT,
  BAND_TIER_KEY,
  CHOICES,
  choiceOf,
  createScene,
  hardwareSignalsOf,
  probe,
  readStorage,
  readViewport,
  rendererMbOf,
  storeChoice
} from './band-overlay-inputs'
import { QUALITY_FULL, QUALITY_LITE, type BandModel, type BandScene } from './band-scene'
import { createFrameMeter } from './band-frame-meter'
import { bandRegistryEntry, type BandPaneStats } from './band-registry'
import { watchBandVisibility } from './band-visibility'

const HIDDEN_RELEASE_MS = 5000
const SCAN_EVERY_MS = 250

export function attachGameBand3d(
  paneId: number,
  terminal: Terminal,
  container: HTMLElement
): () => void {
  // Why: pane unit tests open terminals in a DOM-less environment with stub terminals.
  if (typeof IntersectionObserver === 'undefined' || typeof terminal.onScroll !== 'function') {
    return () => {}
  }
  const dom = createOverlayDom(container)
  const stats: BandPaneStats = bandRegistryEntry(paneId)
  let choice = choiceOf()
  let mode: BandMode = 'cells'
  let scene: BandScene | null = null
  let creating = false
  let region: BandRegion | null = null
  let visible = true
  let hiddenSince: number | null = null
  let raf: number | null = null
  let lastFrame = 0
  const meter = createFrameMeter()
  const windows: BandWindow[] = []
  let baselineMb = 0
  let model: BandModel = bandModelAt(0)
  const startedAt = performance.now()
  let disposed = false

  const quality = (): typeof QUALITY_FULL =>
    mode === '3d-lite' || readStorage(BAND_TIER_KEY) === 'lite' ? QUALITY_LITE : QUALITY_FULL

  const note = (what: string): void => {
    stats.events.push({ atMs: Math.round(performance.now() - startedAt), what })
    stats.events.splice(0, Math.max(0, stats.events.length - 200))
  }

  const releaseScene = (reason: string): void => {
    if (raf !== null) {
      cancelAnimationFrame(raf)
      raf = null
    }
    if (scene !== null) {
      const released = scene
      // Why first: three's dispose forces a context loss, which must not count as a GPU reset.
      scene = null
      released.dispose()
      released.canvas.remove()
      stats.scenesReleased += 1
      note(`released ${released.lib}: ${reason}`)
    }
    dom.root.style.display = 'none'
  }

  const updateChip = (fps: number | null): void =>
    dom.setChip(choice, scene?.lib ?? 'cells', mode, fps)

  const layout = (): void => {
    if (region === null || scene === null) {
      return
    }
    const box = bandBoxOf(terminal, container, region)
    if (box === null) {
      return
    }
    const { width, height } = box
    Object.assign(dom.root.style, {
      display: 'block',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${width}px`,
      height: `${height}px`
    })
    scene.resize(width, height, quality())
    stats.region = { ...region, widthPx: Math.round(width), heightPx: Math.round(height) }
  }

  const closeWindow = async (now: number): Promise<void> => {
    const frames = meter.take(now)
    const sample = await probe()
    const mb = rendererMbOf(sample)
    if (baselineMb === 0) {
      baselineMb = mb.renderer
    }
    const targetFps = Math.min(quality().fpsCap, sample?.displayHz || 60)
    const window: BandWindow = {
      fps: frames.fps,
      targetFps,
      renderP95Ms: frames.renderP95Ms,
      rendererGrowthMb: mb.renderer - baselineMb
    }
    windows.push(window)
    stats.windows.push({
      atMs: Math.round(now - startedAt),
      ...frames,
      targetFps,
      rendererMb: mb.renderer,
      gpuMb: mb.gpu
    })
    stats.windows.splice(0, Math.max(0, stats.windows.length - 400))
    updateChip(frames.fps)
    if (choice === 'auto') {
      const next = nextBandModeOf(mode, windows)
      if (next !== mode) {
        note(`downgrade ${mode} -> ${next}`)
        stats.downgrades.push({ from: mode, to: next, atMs: Math.round(now - startedAt) })
        mode = next
        if (next === 'cells') {
          releaseScene(`downgrade to ${next}`)
        } else {
          layout()
        }
      }
    }
  }

  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick)
    if (scene === null) {
      return
    }
    const budget = 1000 / quality().fpsCap
    if (lastFrame !== 0 && now - lastFrame < budget - 2) {
      return
    }
    const interval = lastFrame === 0 ? null : now - lastFrame
    lastFrame = now
    model = bandModelAt(now - startedAt)
    const renderStart = performance.now()
    scene.render(now - startedAt, model)
    meter.add(interval, performance.now() - renderStart)
    if (stats.firstFrameMs === null) {
      stats.firstFrameMs = Math.round(now - stats.sceneRequestedAt)
    }
    stats.frames += 1
    if (stats.frames % 6 === 0) {
      stats.rects = scene.memberRects()
      dom.setTags(model, stats.rects)
      stats.lives = model.members.map((member) => member.lives)
    }
    if (meter.isDue(now)) {
      void closeWindow(now)
    }
  }

  const ensureScene = async (): Promise<void> => {
    if (scene !== null || creating || mode === 'cells' || mode === 'flat' || mode === 'off') {
      return
    }
    creating = true
    stats.sceneRequestedAt = performance.now()
    stats.firstFrameMs = null
    const lib = choice === 'auto' || choice === 'cells' ? AUTO_LIB : choice
    try {
      const created = await createScene(lib)
      if (disposed || !visible || region === null) {
        created.dispose()
        return
      }
      stats.rendererName = created.rendererName
      const status = stats.signals?.webglFeatureStatus ?? 'enabled'
      // Why: SwiftShader can report webgl `enabled`; only the renderer string tells.
      if (choice === 'auto' && webglClassOf(created.rendererName, status) !== 'hardware') {
        created.dispose()
        note(`auto keeps cells: software WebGL (${created.rendererName ?? 'none'})`)
        stats.autoPick = 'cells'
        mode = 'cells'
        return
      }
      scene = created
      stats.lib = lib
      stats.scenesCreated += 1
      note(`created ${lib} in ${mode} on ${created.rendererName ?? 'unknown renderer'}`)
      created.canvas.addEventListener('webglcontextlost', (event) => {
        if (scene !== created) {
          return
        }
        event.preventDefault()
        stats.contextLosses += 1
        releaseScene('webgl context lost')
        // Why: a GPU reset or sleep/wake recovers on the next scan; a second loss stays on cells.
        mode = stats.contextLosses > 1 ? 'cells' : mode
        updateChip(null)
      })
      dom.host.append(created.canvas)
      lastFrame = 0
      meter.reset(performance.now())
      layout()
      raf ??= requestAnimationFrame(tick)
    } catch (error) {
      stats.errors.push(String(error))
      mode = 'cells'
    } finally {
      creating = false
      updateChip(null)
    }
  }

  const resolveMode = async (): Promise<void> => {
    choice = choiceOf()
    if (choice === 'cells') {
      mode = 'cells'
      releaseScene('choice is cells')
      updateChip(null)
      return
    }
    const { signals, webglFeatureStatus } = hardwareSignalsOf(await probe())
    stats.signals = { ...signals, webglFeatureStatus }
    const picked = initialBandModeOf(signals)
    // Why: a forced library is how the soak measures 3D on tiers auto would never pick.
    mode =
      choice === 'auto' ? picked : readStorage(BAND_TIER_KEY) === 'lite' ? '3d-lite' : '3d-full'
    stats.autoPick = picked
    stats.mode = mode
    updateChip(null)
  }

  const scan = (): void => {
    if (disposed) {
      return
    }
    region = findBandRegion(terminal.rows, readViewport(terminal))
    stats.mode = mode
    const shown = visible && region !== null
    if (!shown) {
      if (raf !== null) {
        cancelAnimationFrame(raf)
        raf = null
      }
      dom.root.style.display = 'none'
      hiddenSince ??= performance.now()
      if (scene !== null && performance.now() - hiddenSince > HIDDEN_RELEASE_MS) {
        releaseScene('band hidden or gone for 5 s')
      }
      stats.paused = true
      return
    }
    hiddenSince = null
    stats.paused = false
    if (scene === null) {
      void ensureScene()
      return
    }
    layout()
    raf ??= requestAnimationFrame(tick)
  }

  dom.chip.addEventListener('click', () => {
    const next = CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length] ?? 'auto'
    note(`chip clicked: ${choice} -> ${next}`)
    storeChoice(next)
    releaseScene('chip clicked')
    void resolveMode().then(scan)
  })
  dom.wirePicking(
    () => ({ rects: scene?.memberRects() ?? [], members: model.members, ci: model.ci }),
    (key) => {
      stats.cardShownFor = key
    }
  )

  const stopVisibility = watchBandVisibility(container, (shown, why) => {
    if (shown !== visible) {
      note(why)
    }
    visible = shown
    scan()
  })
  const onChoice = (): void => {
    releaseScene('choice changed')
    void resolveMode().then(scan)
  }
  window.addEventListener(BAND_CHOICE_EVENT, onChoice)
  const subscriptions = [terminal.onResize(scan), terminal.onScroll(scan)]
  const timer = window.setInterval(scan, SCAN_EVERY_MS)
  void resolveMode().then(scan)

  return () => {
    disposed = true
    window.clearInterval(timer)
    stopVisibility()
    window.removeEventListener(BAND_CHOICE_EVENT, onChoice)
    subscriptions.forEach((one) => one.dispose())
    releaseScene('pane closed')
    dom.dispose()
    stats.detached = true
  }
}
