import type {
  MemoryPressurePane,
  MemoryPressureReading,
  MemoryPressureState,
  MemoryPressureWarning
} from '../../shared/memory-pressure-types'
import type { MemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import {
  findSustainedMemoryPressureTrigger,
  isReadingUnderPressure
} from './memory-pressure-evaluation'
import {
  isWorseSeverity,
  severityOf,
  worstOf,
  type MemoryPressureSeverity
} from './memory-pressure-severity'

const DEFAULT_INTERVAL_MS = 30_000
// Why: a later tick than this means sleep or a stalled main process, not a sustained signal.
const MAX_GAP_INTERVALS = 3
const HISTORY_WINDOW_MS = 5 * 60_000
const EXIT_HOLD_MS = 10 * 60_000
const MIN_POPUP_INTERVAL_MS = 30 * 60_000

export type MemoryPressureMonitorDeps = {
  readPressure: () => Promise<MemoryPressureReading>
  collectPanes: () => Promise<MemoryPressurePane[]>
  getSettings: () => MemoryPressureWarningSettings
  broadcast: (state: MemoryPressureState) => void
  intervalMs?: number
}

type Episode = {
  id: number
  lastPressureAt: number
  peak: MemoryPressureSeverity
  /** Peak at dismiss time; the popup stays hidden until a reading is worse than this. */
  dismissedAt: MemoryPressureSeverity | null
}

/**
 * Samples system memory on a modest interval and keeps a short reading window. A popup opens
 * only on a sustained signal, at most once per situation. The per-pane sweep (ps + top) runs
 * only when a popup shows and on demand.
 */
export class MemoryPressureMonitor {
  private timer: NodeJS.Timeout | null = null
  private inflight: Promise<void> | null = null
  private history: MemoryPressureReading[] = []
  private episodeId = 0
  private episode: Episode | null = null
  private lastOpened: { at: number; peak: MemoryPressureSeverity } | null = null
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
      this.reset()
      return
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.intervalMs())
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
    if (!this.episode || episodeId !== this.episode.id || !this.isVisible()) {
      return
    }
    this.episode.dismissedAt = this.episode.peak
    this.deps.broadcast({ warning: null })
  }

  async refresh(): Promise<MemoryPressureState> {
    if (this.isVisible() && this.warning) {
      await this.sweep(this.warning.episodeId)
    }
    return this.getState()
  }

  private intervalMs(): number {
    return this.deps.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  private isVisible(): boolean {
    return this.warning !== null && this.episode !== null && this.episode.dismissedAt === null
  }

  private remember(reading: MemoryPressureReading): void {
    const previous = this.history.at(-1)
    if (previous && reading.readAt - previous.readAt > this.intervalMs() * MAX_GAP_INTERVALS) {
      this.history = []
    }
    this.history.push(reading)
    const oldest = reading.readAt - HISTORY_WINDOW_MS
    this.history = this.history.filter((entry) => entry.readAt >= oldest)
  }

  private async sample(): Promise<void> {
    const settings = this.deps.getSettings()
    if (!settings.enabled) {
      this.reset()
      return
    }
    const reading = await this.deps.readPressure()
    this.remember(reading)
    const trigger = findSustainedMemoryPressureTrigger(this.history, settings.thresholdPercent)
    const severity = severityOf(reading)

    const episode = this.episode
    if (episode && this.warning) {
      const underPressure =
        trigger !== null || isReadingUnderPressure(reading, settings.thresholdPercent)
      if (!underPressure) {
        if (reading.readAt - episode.lastPressureAt >= EXIT_HOLD_MS) {
          this.closeEpisode()
        }
        return
      }
      episode.lastPressureAt = reading.readAt
      episode.peak = worstOf(episode.peak, severity)
      // Why: the next popup must beat the worst this one saw, not the level it opened at.
      if (this.lastOpened) {
        this.lastOpened.peak = episode.peak
      }
      this.warning = { ...this.warning, reading, trigger: trigger ?? this.warning.trigger }
      if (episode.dismissedAt && trigger && isWorseSeverity(severity, episode.dismissedAt, true)) {
        episode.dismissedAt = null
        await this.showAndSweep(episode.id)
        return
      }
      if (this.isVisible()) {
        this.deps.broadcast(this.getState())
      }
      return
    }

    if (!trigger) {
      return
    }
    const recent = this.lastOpened && reading.readAt - this.lastOpened.at < MIN_POPUP_INTERVAL_MS
    if (recent && this.lastOpened && !isWorseSeverity(severity, this.lastOpened.peak, false)) {
      return
    }
    this.episodeId += 1
    this.episode = {
      id: this.episodeId,
      lastPressureAt: reading.readAt,
      peak: severity,
      dismissedAt: null
    }
    this.lastOpened = { at: reading.readAt, peak: severity }
    this.warning = { episodeId: this.episodeId, reading, trigger, panes: [], sweeping: true }
    await this.showAndSweep(this.episodeId)
  }

  private async showAndSweep(episodeId: number): Promise<void> {
    if (this.warning) {
      this.warning = { ...this.warning, sweeping: true }
    }
    this.deps.broadcast(this.getState())
    await this.sweep(episodeId)
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

  private reset(): void {
    this.history = []
    this.closeEpisode()
  }

  private closeEpisode(): void {
    const wasVisible = this.isVisible()
    this.episode = null
    this.warning = null
    if (wasVisible) {
      this.deps.broadcast({ warning: null })
    }
  }
}
