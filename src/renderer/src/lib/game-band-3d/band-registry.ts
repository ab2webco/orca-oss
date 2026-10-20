// What the overlay measured, per pane, for the E2E soak to read through `window.__gameBand3d`.
import type { BandMode, HardwareSignals } from './band-mode'
import type { BandRegion } from './band-region'
import type { BandLib, MemberRect } from './band-scene'

export type BandPaneStats = {
  lib: BandLib | null
  mode: BandMode
  autoPick: BandMode | null
  signals: (HardwareSignals & { webglFeatureStatus: string }) | null
  rendererName: string | null
  sceneRequestedAt: number
  firstFrameMs: number | null
  frames: number
  windows: {
    atMs: number
    fps: number
    frameP50Ms: number
    frameP95Ms: number
    targetFps: number
    renderP50Ms: number
    renderP95Ms: number
    rendererMb: number
    gpuMb: number
  }[]
  downgrades: { from: BandMode; to: BandMode; atMs: number }[]
  region: (BandRegion & { widthPx: number; heightPx: number }) | null
  lives: number[]
  paused: boolean
  scenesCreated: number
  scenesReleased: number
  contextLosses: number
  cardShownFor: string | null
  rects: MemberRect[]
  /** Band rows found in the viewport, in every mode, cells included. */
  detectedRows: number
  events: { atMs: number; what: string }[]
  errors: string[]
  detached: boolean
}

type BandRegistry = { panes: Record<string, BandPaneStats> }

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __gameBand3d?: BandRegistry
  }
}

export const bandRegistryEntry = (paneId: number): BandPaneStats => {
  const registry = (window.__gameBand3d ??= { panes: {} })
  const stats: BandPaneStats = {
    lib: null,
    mode: 'cells',
    autoPick: null,
    signals: null,
    rendererName: null,
    sceneRequestedAt: 0,
    firstFrameMs: null,
    frames: 0,
    windows: [],
    downgrades: [],
    region: null,
    lives: [],
    paused: true,
    scenesCreated: 0,
    scenesReleased: 0,
    contextLosses: 0,
    cardShownFor: null,
    rects: [],
    detectedRows: 0,
    events: [],
    errors: [],
    detached: false
  }
  registry.panes[String(paneId)] = stats
  return stats
}
