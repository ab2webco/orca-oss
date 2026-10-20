// ORCA-692 POC: draws the game band with WebGL over the band rows of a terminal pane.
import type { Terminal } from '@xterm/xterm'
import { bandModelAt } from './band-demo-model'
import {
  BAND_BUDGETS,
  initialBandModeOf,
  nextBandModeOf,
  webglClassOf,
  type BandMode,
  type BandWindow
} from './band-mode'
import { createOverlayDom, memberAt, type MemberHit } from './band-overlay-dom'
import { findBandRegion, type BandRegion } from './band-region'
import {
  AUTO_LIB,
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
import { frameWindowOf } from './frame-stats'
import { bandRegistryEntry, type BandPaneStats } from './band-registry'

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
  let windowStart = 0
  let intervals: number[] = []
  const windows: BandWindow[] = []
  let baselineMb = 0
  let model: BandModel = bandModelAt(0)
  const startedAt = performance.now()
  let disposed = false

  const quality = (): typeof QUALITY_FULL =>
    mode === '3d-lite' || readStorage(BAND_TIER_KEY) === 'lite' ? QUALITY_LITE : QUALITY_FULL

  const releaseScene = (): void => {
    if (raf !== null) {
      cancelAnimationFrame(raf)
      raf = null
    }
    if (scene !== null) {
      scene.dispose()
      scene.canvas.remove()
      scene = null
      stats.scenesReleased += 1
    }
    dom.root.style.display = 'none'
  }

  const updateChip = (fps: number | null): void => {
    const lib = scene?.lib ?? 'cells'
    dom.chip.textContent = `POC · ${choice} · ${lib} · ${mode}${fps === null ? '' : ` · ${fps} fps`}`
  }

  const layout = (): void => {
    if (region === null || scene === null) {
      return
    }
    const screen = terminal.element?.querySelector('.xterm-screen')
    if (!(screen instanceof HTMLElement)) {
      return
    }
    const screenRect = screen.getBoundingClientRect()
    const box = container.getBoundingClientRect()
    const cellW = screenRect.width / terminal.cols
    const cellH = screenRect.height / terminal.rows
    const width = region.cols * cellW
    const height = region.rows * cellH
    Object.assign(dom.root.style, {
      display: 'block',
      left: `${screenRect.left - box.left + region.left * cellW}px`,
      top: `${screenRect.top - box.top + region.top * cellH}px`,
      width: `${width}px`,
      height: `${height}px`
    })
    scene.resize(width, height, quality())
    stats.region = { ...region, widthPx: Math.round(width), heightPx: Math.round(height) }
  }

  const closeWindow = async (now: number): Promise<void> => {
    const frames = frameWindowOf(intervals, now - windowStart)
    intervals = []
    windowStart = now
    const sample = await probe()
    const mb = rendererMbOf(sample)
    if (baselineMb === 0) {
      baselineMb = mb.renderer
    }
    const window: BandWindow = {
      fps: frames.fps,
      frameP95Ms: frames.frameP95Ms,
      rendererGrowthMb: mb.renderer - baselineMb
    }
    windows.push(window)
    stats.windows.push({
      atMs: Math.round(now - startedAt),
      ...frames,
      rendererMb: mb.renderer,
      gpuMb: mb.gpu
    })
    stats.windows.splice(0, Math.max(0, stats.windows.length - 400))
    updateChip(frames.fps)
    if (choice === 'auto') {
      const next = nextBandModeOf(mode, windows)
      if (next !== mode) {
        stats.downgrades.push({ from: mode, to: next, atMs: Math.round(now - startedAt) })
        mode = next
        if (next === 'cells') {
          releaseScene()
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
    if (lastFrame !== 0) {
      intervals.push(now - lastFrame)
    }
    lastFrame = now
    model = bandModelAt(now - startedAt)
    scene.render(now - startedAt, model)
    if (stats.firstFrameMs === null) {
      stats.firstFrameMs = Math.round(now - stats.sceneRequestedAt)
    }
    stats.frames += 1
    if (stats.frames % 6 === 0) {
      dom.setTags(model, scene.memberRects())
      stats.lives = model.members.map((member) => member.lives)
    }
    if (now - windowStart >= BAND_BUDGETS.windowMs) {
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
      const webgl = webglClassOf(
        created.rendererName,
        stats.signals?.webglFeatureStatus ?? 'enabled'
      )
      if (choice === 'auto' && webgl !== 'hardware') {
        // Why: SwiftShader can report webgl `enabled`; only the renderer string tells.
        created.dispose()
        stats.autoPick = 'cells'
        stats.downgrades.push({
          from: mode,
          to: 'cells',
          atMs: Math.round(performance.now() - startedAt)
        })
        mode = 'cells'
        return
      }
      scene = created
      stats.lib = lib
      stats.scenesCreated += 1
      created.canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault()
        stats.contextLosses += 1
        releaseScene()
        // Why: a GPU reset or sleep/wake recovers on the next scan; a second loss stays on cells.
        mode = stats.contextLosses > 1 ? 'cells' : mode
        updateChip(null)
      })
      dom.host.append(created.canvas)
      lastFrame = 0
      windowStart = performance.now()
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
      releaseScene()
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
    const shown = visible && region !== null && document.visibilityState === 'visible'
    if (!shown) {
      if (raf !== null) {
        cancelAnimationFrame(raf)
        raf = null
      }
      dom.root.style.display = 'none'
      hiddenSince ??= performance.now()
      if (scene !== null && performance.now() - hiddenSince > HIDDEN_RELEASE_MS) {
        releaseScene()
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
    storeChoice(CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length] ?? 'auto')
    releaseScene()
    void resolveMode().then(scan)
  })
  const pick = (event: MouseEvent): MemberHit | null =>
    memberAt(dom.root, event, scene?.memberRects() ?? [], model.members)
  dom.host.addEventListener('mousemove', (event) => {
    dom.host.style.cursor = pick(event) === null ? 'default' : 'pointer'
  })
  dom.host.addEventListener('click', (event) => {
    const hit = pick(event)
    dom.showCard(hit?.member ?? null, hit?.rect ?? null, model.ci)
    stats.cardShownFor = hit?.member.key ?? null
  })

  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting)
    scan()
  })
  intersection.observe(container)
  const onVisibility = (): void => scan()
  document.addEventListener('visibilitychange', onVisibility)
  const subscriptions = [terminal.onResize(scan), terminal.onScroll(scan)]
  const timer = window.setInterval(scan, SCAN_EVERY_MS)
  void resolveMode().then(scan)

  return () => {
    disposed = true
    window.clearInterval(timer)
    intersection.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    subscriptions.forEach((one) => one.dispose())
    releaseScene()
    dom.dispose()
    stats.detached = true
  }
}
