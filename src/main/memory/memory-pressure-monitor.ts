import type {
  MemoryPressurePane,
  MemoryPressureReading,
  MemoryPressureState,
  MemoryPressureWarning
} from '../../shared/memory-pressure-types'
import type { MemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import { isMemoryPressureElevated } from './memory-pressure-evaluation'

const DEFAULT_INTERVAL_MS = 30_000

export type MemoryPressureMonitorDeps = {
  readPressure: () => Promise<MemoryPressureReading>
  collectPanes: () => Promise<MemoryPressurePane[]>
  getSettings: () => MemoryPressureWarningSettings
  broadcast: (state: MemoryPressureState) => void
  intervalMs?: number
}

/**
 * Samples system memory on a modest interval and opens one warning episode per
 * normal-to-elevated transition. The per-pane sweep (ps + top) runs only when an
 * episode opens and on demand, never per tick.
 */
export class MemoryPressureMonitor {
  private timer: NodeJS.Timeout | null = null
  private inflight: Promise<void> | null = null
  private elevated = false
  private episodeId = 0
  private dismissedEpisodeId = 0
  private warning: MemoryPressureWarning | null = null

  constructor(private readonly deps: MemoryPressureMonitorDeps) {}

  start(): void {
    this.applySettings()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  applySettings(): void {
    if (!this.deps.getSettings().enabled) {
      this.stop()
      this.closeEpisode()
      return
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? DEFAULT_INTERVAL_MS)
      this.timer.unref?.()
      void this.tick()
    }
  }

  getState(): MemoryPressureState {
    return { warning: this.isVisible() ? this.warning : null }
  }

  tick(): Promise<void> {
    // Why: spawns are slowest under thrash; a slow reading must not stack another behind it.
    if (!this.inflight) {
      this.inflight = this.sample().finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  dismiss(episodeId: number): void {
    if (episodeId !== this.episodeId || !this.isVisible()) {
      return
    }
    this.dismissedEpisodeId = episodeId
    this.deps.broadcast({ warning: null })
  }

  async refresh(): Promise<MemoryPressureState> {
    if (this.isVisible()) {
      await this.sweep(this.episodeId)
    }
    return this.getState()
  }

  private isVisible(): boolean {
    return this.warning !== null && this.dismissedEpisodeId !== this.warning.episodeId
  }

  private async sample(): Promise<void> {
    const settings = this.deps.getSettings()
    if (!settings.enabled) {
      this.closeEpisode()
      return
    }
    const reading = await this.deps.readPressure()
    const elevated = isMemoryPressureElevated(reading, settings.thresholdPercent, this.elevated)
    if (!elevated) {
      this.closeEpisode()
      return
    }
    if (this.elevated && this.warning) {
      this.warning = { ...this.warning, reading }
      if (this.isVisible()) {
        this.deps.broadcast(this.getState())
      }
      return
    }
    this.elevated = true
    this.episodeId += 1
    this.warning = { episodeId: this.episodeId, reading, panes: [], sweeping: true }
    this.deps.broadcast(this.getState())
    await this.sweep(this.episodeId)
  }

  private async sweep(episodeId: number): Promise<void> {
    let panes: MemoryPressurePane[] = []
    try {
      panes = await this.deps.collectPanes()
    } catch {
      // A failed sweep still ends the spinner; the warning stands on the system reading.
    }
    // Why: the episode may have closed or been dismissed while the sweep ran.
    if (!this.warning || this.warning.episodeId !== episodeId) {
      return
    }
    this.warning = { ...this.warning, panes, sweeping: false }
    if (this.isVisible()) {
      this.deps.broadcast(this.getState())
    }
  }

  private closeEpisode(): void {
    const wasVisible = this.isVisible()
    this.elevated = false
    this.warning = null
    if (wasVisible) {
      this.deps.broadcast({ warning: null })
    }
  }
}
