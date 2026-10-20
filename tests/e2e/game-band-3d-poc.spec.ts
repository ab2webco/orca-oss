/**
 * ORCA-692 decision spike (never merges): the WebGL game band overlay in a real terminal pane, per
 * hardware tier. Headless project in background-window mode: a hidden E2E window gets no animation
 * frames, so the window is shown inactive, unfocusable and click-through at the screen's right edge.
 *
 *   ORCA_BAND_TIER=0..3  ORCA_BAND_LIB=three|ogl|pixi|auto|cells  ORCA_BAND_SOAK_MS=600000
 *   ORCA_BAND_SHOTS=1 (widths x themes)  ORCA_BAND_PANES=5 (five bands at once)
 */
import { writeFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  execInTerminal,
  splitActiveTerminalPane,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const TIER = Number(process.env.ORCA_BAND_TIER ?? '3')
const LIB = process.env.ORCA_BAND_LIB ?? 'three'
const SOAK_MS = Number(process.env.ORCA_BAND_SOAK_MS ?? '60000')
const SAMPLE_MS = 30_000
const PANES = Number(process.env.ORCA_BAND_PANES ?? '1')
const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

// Why these flags: --disable-gpu alone leaves macOS with no WebGL at all, not SwiftShader.
const TIER_ARGS: Record<number, string[]> = {
  0: ['--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
}

// Why: the parked window is mostly off screen or covered; occlusion would throttle its frames.
const PAINT_ARGS = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']

test.use({
  orcaAppExtraArgs: [...PAINT_ARGS, ...(TIER_ARGS[TIER] ?? [])],
  orcaAppExtraEnv: {
    ORCA_E2E_BACKGROUND_WINDOW: '1',
    ...(TIER === 1 ? { ORCA_POC_TOTAL_MEMORY_GB: '8' } : {})
  }
})

type Stats = {
  lib: string | null
  mode: string
  autoPick: string | null
  rendererName: string | null
  firstFrameMs: number | null
  frames: number
  windows: {
    atMs: number
    fps: number
    frameP50Ms: number
    frameP95Ms: number
    rendererMb: number
    gpuMb: number
  }[]
  downgrades: { from: string; to: string; atMs: number }[]
  region: {
    top: number
    rows: number
    left: number
    cols: number
    widthPx: number
    heightPx: number
  } | null
  lives: number[]
  paused: boolean
  scenesCreated: number
  scenesReleased: number
  contextLosses: number
  cardShownFor: string | null
  rects: { key: string; x: number; y: number; width: number; height: number }[]
  signals: Record<string, unknown> | null
  errors: string[]
  detached: boolean
}

const allStats = (page: Page): Promise<Stats[]> =>
  page.evaluate(() =>
    Object.values(window.__gameBand3d?.panes ?? {}).filter((one) => !one.detached)
  ) as Promise<Stats[]>

const liveStats = async (page: Page): Promise<Stats | null> =>
  (await allStats(page)).find((one) => one.region !== null) ?? null

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(() =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** Animation frames per second over `ms`; zero when the window gets none (hidden). */
const rafFps = (page: Page, ms = 2000): Promise<number> =>
  page.evaluate(
    (span) =>
      new Promise<number>((resolve) => {
        let frames = 0
        const start = performance.now()
        const step = (): void => {
          frames += 1
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
        setTimeout(() => resolve(Math.round((frames * 1000) / (performance.now() - start))), span)
      }),
    ms
  )

const framesOf = async (page: Page): Promise<number> => (await liveStats(page))?.frames ?? 0

/** A fixed busy loop; under a 4x CPU throttle it must take clearly longer. */
const busyLoopMs = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const start = performance.now()
    let x = 0
    for (let i = 0; i < 2e7; i += 1) {
      x += Math.sqrt(i)
    }
    return x > 0 ? performance.now() - start : -1
  })

test('game band WebGL overlay on one hardware tier (ORCA-692)', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(SOAK_MS + 8 * 60_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  // Proof the window gets real frames before any FPS is trusted (a hidden one gets none).
  const rafBaselineFps = await rafFps(orcaPage)
  const windowState = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { visible: win?.isVisible() ?? false, focused: win?.isFocused() ?? false }
  })
  expect(windowState.focused, 'the background window took focus').toBe(false)
  expect(rafBaselineFps, 'the window is not receiving animation frames').toBeGreaterThan(20)

  const printer = testInfo.outputPath('game-band-printer.mjs')
  buildSync({
    entryPoints: ['tests/e2e/fixtures/game-band-printer.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: printer,
    logLevel: 'warning'
  })

  await orcaPage.evaluate(
    ({ lib, lite }) => {
      window.localStorage.setItem('orca.poc.band3d', lib)
      window.localStorage.setItem('orca.poc.band3d.tier', lite ? 'lite' : 'full')
      window.dispatchEvent(new Event('orca:game-band-3d-choice'))
    },
    { lib: LIB, lite: TIER < 3 }
  )

  for (let pane = 0; pane < PANES; pane += 1) {
    if (pane > 0) {
      await splitActiveTerminalPane(orcaPage, pane % 2 === 0 ? 'vertical' : 'horizontal')
    }
    const ptyId = await waitForActivePanePtyId(orcaPage)
    await execInTerminal(orcaPage, ptyId, `clear && node '${printer}'`)
  }

  const cdp = TIER <= 1 ? await orcaPage.context().newCDPSession(orcaPage) : null
  const throttle = { beforeMs: 0, afterMs: 0 }
  if (TIER === 1 && cdp !== null) {
    throttle.beforeMs = await busyLoopMs(orcaPage)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    throttle.afterMs = await busyLoopMs(orcaPage)
    expect(throttle.afterMs, 'the 4x CPU throttle did not apply').toBeGreaterThan(
      throttle.beforeMs * 2.5
    )
  }

  const drawsWebgl = LIB !== 'cells' && !(LIB === 'auto' && TIER === 0)
  await expect
    .poll(async () => (await liveStats(orcaPage))?.region?.rows ?? 0, {
      timeout: 30_000,
      message: 'no band found in the terminal'
    })
    .toBeGreaterThanOrEqual(9)
  if (drawsWebgl && LIB !== 'auto') {
    await expect
      .poll(async () => (await liveStats(orcaPage))?.frames ?? 0, {
        timeout: 30_000,
        message: 'the overlay never drew a frame'
      })
      .toBeGreaterThan(30)
  }

  const samples: unknown[] = []
  const started = Date.now()
  const sample = async (): Promise<void> => {
    const metrics = await electronApp.evaluate(({ app }) =>
      app.getAppMetrics().map((m) => ({
        type: m.type,
        pid: m.pid,
        workingSetMb: m.memory.workingSetSize / 1024,
        cpu: m.cpu.percentCPUUsage
      }))
    )
    const stats = await liveStats(orcaPage)
    samples.push({
      atMs: Date.now() - started,
      metrics,
      window: stats?.windows.at(-1) ?? null,
      lives: stats?.lives ?? []
    })
  }
  await sample()
  let shot = 0
  while (Date.now() - started < SOAK_MS) {
    await orcaPage.waitForTimeout(Math.min(SAMPLE_MS, SOAK_MS - (Date.now() - started)))
    await sample()
    if (shot < 3) {
      await orcaPage.screenshot({
        path: testInfo.outputPath(`tier${TIER}-${LIB}-soak-${shot}.png`)
      })
      shot += 1
    }
  }

  const stats = await liveStats(orcaPage)
  expect(stats, 'the band overlay stats vanished').not.toBeNull()
  const allPanes = await allStats(orcaPage)

  // Click a character: its card shows ticket, PR, CI and lives.
  const hit = stats?.rects.find((rect) => rect.key !== 'demo-lead')
  if (drawsWebgl && stats?.mode !== 'cells' && hit !== undefined) {
    const box = await orcaPage.locator('[data-testid="game-band-3d"]').first().boundingBox()
    if (box !== null) {
      await orcaPage.mouse.click(box.x + hit.x + hit.width / 2, box.y + hit.y + hit.height / 2)
      await expect(orcaPage.locator('.game-band-3d-card').first()).toContainText('Ticket')
      await orcaPage.screenshot({ path: testInfo.outputPath(`tier${TIER}-${LIB}-card.png`) })
    }
  }

  if (process.env.ORCA_BAND_SHOTS === '1') {
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(1500)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`tier${TIER}-${LIB}-${width}-${theme}.png`)
        })
      }
    }
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
  }

  // Hidden window: rendering must stop. Why no minimise: restoring one can activate the app.
  const releasedBefore = (await liveStats(orcaPage))?.scenesReleased ?? 0
  const visibility = async (): Promise<{
    state: string
    rafFps: number
    overlayFrames: number
    paused: boolean | null
    released: number
  }> => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide())
    await orcaPage.waitForTimeout(1000)
    const before = await framesOf(orcaPage)
    const fps = await rafFps(orcaPage, 6000)
    const after = await liveStats(orcaPage)
    const state = await orcaPage.evaluate(() => document.visibilityState)
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.showInactive()
    )
    await orcaPage.waitForTimeout(3000)
    return {
      state,
      rafFps: fps,
      overlayFrames: (after?.frames ?? before) - before,
      paused: after?.paused ?? null,
      released: after?.scenesReleased ?? 0
    }
  }
  // The window events main actually emitted, to tell a real restore from a spurious one.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const log: string[] = []
    ;(globalThis as { __bandWindowEvents?: string[] }).__bandWindowEvents = log
    const start = Date.now()
    for (const name of ['hide', 'show', 'minimize', 'restore', 'focus', 'blur'] as const) {
      win?.on(name as 'hide', () => log.push(`${Date.now() - start} ${name}`))
    }
  })
  const hiddenRun = await visibility()

  // Context loss: the overlay drops the scene and builds a new one on the next scan.
  let contextLoss: { createdBefore: number; createdAfter: number; losses: number } | null = null
  if (drawsWebgl && (await liveStats(orcaPage))?.mode !== 'cells') {
    const createdBefore = (await liveStats(orcaPage))?.scenesCreated ?? 0
    await orcaPage.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="game-band-3d"] canvas'
      )
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    })
    await expect
      .poll(async () => (await liveStats(orcaPage))?.scenesCreated ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(createdBefore)
    const after = await liveStats(orcaPage)
    contextLoss = {
      createdBefore,
      createdAfter: after?.scenesCreated ?? 0,
      losses: after?.contextLosses ?? 0
    }
  }

  const final = await liveStats(orcaPage)
  writeFileSync(
    testInfo.outputPath(`band-soak-tier${TIER}-${LIB}${PANES > 1 ? `-${PANES}panes` : ''}.json`),
    JSON.stringify(
      {
        tier: TIER,
        lib: LIB,
        panes: PANES,
        soakMs: SOAK_MS,
        throttle,
        rafBaselineFps,
        windowState,
        stats: final,
        paneCount: allPanes.length,
        allPanes: allPanes.map((one) => ({
          lib: one.lib,
          mode: one.mode,
          frames: one.frames,
          windows: one.windows.slice(-5)
        })),
        hidden: {
          releasedBefore,
          hide: hiddenRun,
          windowEvents: await electronApp.evaluate(
            () => (globalThis as { __bandWindowEvents?: string[] }).__bandWindowEvents ?? []
          )
        },
        contextLoss,
        samples
      },
      null,
      2
    )
  )
  if (LIB === 'auto' && TIER === 0) {
    expect(final?.mode, 'auto must leave WebGL on software rendering').toBe('cells')
    expect(final?.rendererName ?? '').toMatch(/swiftshader/i)
  }
  if (drawsWebgl && final?.mode !== 'cells') {
    expect(
      hiddenRun.overlayFrames,
      'the overlay kept drawing while the window was hidden'
    ).toBeLessThan(5)
    const series = samples.map((one) => (one as { lives: number[] }).lives)
    const changed = (series[0] ?? []).some(
      (_, member) => new Set(series.map((lives) => lives[member])).size > 1
    )
    expect(changed, 'no member won or lost a life during the run').toBe(true)
  }
})
