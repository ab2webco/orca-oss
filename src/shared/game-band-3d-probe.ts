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
  processes: GameBand3dProcessSample[]
}
