// ORCA-692 POC: what the band's auto-pick and the soak read from main.
export type GameBand3dProcessSample = {
  type: string
  pid: number
  workingSetMb: number
  cpuPercent: number
}

export type GameBand3dProbe = {
  /** `app.getGPUFeatureStatus().webgl`, e.g. `enabled`, `unavailable_software`. */
  webglFeatureStatus: string
  gpuDevices: { vendorId: number; deviceId: number; active: boolean }[]
  totalMemoryGb: number
  cpuCores: number
  /** The OS pid of the renderer that asked, so its own memory is read, not another tab's. */
  rendererPid: number
  /** Refresh rate of the display the window is on; rAF never runs faster. */
  displayHz: number
  processes: GameBand3dProcessSample[]
}
