// POC auto-pick rule for the game band (ORCA-692). `cells` is today's 2D hd band the mod draws.
export type BandMode = 'off' | 'flat' | 'cells' | '3d-lite' | '3d-full'

export type WebglClass = 'hardware' | 'software' | 'none'

export type HardwareSignals = {
  webgl: WebglClass
  totalMemoryGb: number
  cpuCores: number
  prefersReducedMotion: boolean
}

/** One measurement window of the running band. */
export type BandWindow = { fps: number; frameP95Ms: number; rendererGrowthMb: number }

export const BAND_BUDGETS = {
  fullMinMemoryGb: 16,
  fullMinCores: 8,
  liteMinMemoryGb: 8,
  fullFpsCap: 60,
  liteFpsCap: 30,
  fullMinFps: 50,
  fullMaxFrameP95Ms: 25,
  liteMinFps: 25,
  liteMaxFrameP95Ms: 45,
  /** Renderer working-set growth since the band started; ORCA-600 reached 26 GB unbounded. */
  rendererGrowthMb: 150,
  windowMs: 2000,
  breachWindows: 3
} as const

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software/i

/** `featureStatus` is `app.getGPUFeatureStatus().webgl`; `renderer` is UNMASKED_RENDERER_WEBGL. */
export const webglClassOf = (renderer: string | null, featureStatus: string): WebglClass => {
  if (featureStatus.includes('software')) {
    return 'software'
  }
  if (
    renderer === null ||
    featureStatus.startsWith('disabled') ||
    featureStatus.startsWith('unavailable')
  ) {
    return 'none'
  }
  return SOFTWARE_RENDERER.test(renderer) ? 'software' : 'hardware'
}

export const initialBandModeOf = (signals: HardwareSignals): BandMode => {
  if (signals.prefersReducedMotion) {
    return 'flat'
  }
  if (signals.webgl !== 'hardware' || signals.totalMemoryGb < BAND_BUDGETS.liteMinMemoryGb) {
    return 'cells'
  }
  return signals.totalMemoryGb >= BAND_BUDGETS.fullMinMemoryGb &&
    signals.cpuCores >= BAND_BUDGETS.fullMinCores
    ? '3d-full'
    : '3d-lite'
}

const isSlow = (mode: '3d-lite' | '3d-full', window: BandWindow): boolean =>
  mode === '3d-full'
    ? window.fps < BAND_BUDGETS.fullMinFps || window.frameP95Ms > BAND_BUDGETS.fullMaxFrameP95Ms
    : window.fps < BAND_BUDGETS.liteMinFps || window.frameP95Ms > BAND_BUDGETS.liteMaxFrameP95Ms

/** Drops a level on a sustained breach; never upgrades, so a borderline machine cannot flap. */
export const nextBandModeOf = (mode: BandMode, windows: readonly BandWindow[]): BandMode => {
  if (mode !== '3d-lite' && mode !== '3d-full') {
    return mode
  }
  const last = windows.at(-1)
  if (last !== undefined && last.rendererGrowthMb > BAND_BUDGETS.rendererGrowthMb) {
    return 'cells'
  }
  const recent = windows.slice(-BAND_BUDGETS.breachWindows)
  if (recent.length < BAND_BUDGETS.breachWindows || !recent.every((w) => isSlow(mode, w))) {
    return mode
  }
  return mode === '3d-full' ? '3d-lite' : 'cells'
}
