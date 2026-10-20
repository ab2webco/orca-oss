import { app, ipcMain } from 'electron'
import { cpus, totalmem } from 'node:os'
import type { GameBand3dProbe } from '../../shared/game-band-3d-probe'

type GpuBasicInfo = { gpuDevice?: { vendorId?: number; deviceId?: number; active?: boolean }[] }

const isGpuBasicInfo = (value: unknown): value is GpuBasicInfo =>
  typeof value === 'object' && value !== null

export const readGameBand3dProbe = async (): Promise<GameBand3dProbe> => {
  const info = await app.getGPUInfo('basic').catch((): unknown => null)
  const devices = isGpuBasicInfo(info) ? (info.gpuDevice ?? []) : []
  return {
    webglFeatureStatus: app.getGPUFeatureStatus().webgl ?? 'unknown',
    gpuDevices: devices.map((device) => ({
      vendorId: device.vendorId ?? 0,
      deviceId: device.deviceId ?? 0,
      active: device.active === true
    })),
    totalMemoryGb: totalmem() / 1024 ** 3,
    cpuCores: cpus().length,
    processes: app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetMb: metric.memory.workingSetSize / 1024,
      cpuPercent: metric.cpu.percentCPUUsage
    }))
  }
}

export function registerGameBand3dProbeHandler(): void {
  ipcMain.handle('app:gameBand3dProbe', (): Promise<GameBand3dProbe> => readGameBand3dProbe())
}
