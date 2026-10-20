import type {
  MemoryPressureKernelLevel,
  MemoryPressurePane,
  MemoryPressureReading,
  MemoryPressureReadingSource,
  MemoryPressureState,
  MemoryPressureTrigger,
  MemoryPressureWarning
} from '../../shared/memory-pressure-types'
import type { MemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import {
  availablePercentOf,
  findSustainedMemoryPressureTrigger,
  isLegacyMemoryPressureElevated,
  isReadingUnderPressure
} from './memory-pressure-evaluation'
import {
  isWorseSeverity,
  severityOf,
  worstOf,
  type MemoryPressureSeverity
} from './memory-pressure-severity'
import {
  MEMORY_PRESSURE_TREND_WINDOW_MS,
  estimateMinutesToExhaustion
} from './memory-pressure-trend'

const DEFAULT_INTERVAL_MS = 30_000
// Why: a later tick than this means sleep or a stalled main process, not a sustained signal.
const MAX_GAP_INTERVALS = 3
const TREND_HORIZON_MINUTES = 10
const EXIT_HOLD_MS = 10 * 60_000
const MIN_POPUP_INTERVAL_MS = 30 * 60_000

export type MemoryPressurePopupRecord = {
  /** legacy-would-open is the pre-ORCA-691 rule's popup, counted for the before/after comparison. */
  event: 'opened' | 'reshown' | 'legacy-would-open'
  at: number
  episodeId: number | null
  trigger: MemoryPressureTrigger | null
  source: MemoryPressureReadingSource
  kernelLevel: MemoryPressureKernelLevel | null
  availablePercent: number
  swapUsedPercent: number | null
  minutesToExhaustion: number | null
  agentPanes: number
}

export type MemoryPressureMonitorDeps = {
  readPressure: () => Promise<MemoryPressureReading>
  collectPanes: () => Promise<MemoryPressurePane[]>
  getSettings: () => MemoryPressureWarningSettings
  broadcast: (state: MemoryPressureState) => void
  /** Local terminal panes with a live agent; SSH agents run elsewhere and do not count. */
  countLocalAgentPanes: () => number
  recordPopup: (record: MemoryPressurePopupRecord) => void
  intervalMs?: number
}

type Episode = {
  id: number
  lastPressureAt: number
  peak: MemoryPressureSeverity
  /** Peak at dismiss time; the popup stays hidden until a reading is worse than this. */
  dismissedAt: MemoryPressureSeverity | null
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Samples system memory on a modest interval and keeps a short reading window. A popup opens
 * only on a sustained signal or a short time to exhaustion while a local agent runs, at most
 * once per situation. The per-pane sweep (ps + top) runs only when a popup shows and on demand.
 */
export class MemoryPressureMonitor {
  private timer: NodeJS.Timeout | null = null
  private inflight: Promise<void> | null = null
  private history: MemoryPressureReading[] = []
  private episodeId = 0
  private episode: Episode | null = null
  private lastOpened: { at: number; peak: MemoryPressureSeverity } | null = null
  private legacyElevated = false
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
    const oldest = reading.readAt - MEMORY_PRESSURE_TREND_WINDOW_MS
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
    const minutesToExhaustion = estimateMinutesToExhaustion(this.history)
    const trigger =
      findSustainedMemoryPressureTrigger(this.history, settings.thresholdPercent) ??
      (minutesToExhaustion !== null && minutesToExhaustion < TREND_HORIZON_MINUTES
        ? 'exhaustion-predicted'
        : null)
    const severity = severityOf(reading, minutesToExhaustion)
    this.countLegacy(reading, settings.thresholdPercent, minutesToExhaustion)

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
      this.warning = {
        ...this.warning,
        reading,
        trigger: trigger ?? this.warning.trigger,
        minutesToExhaustion
      }
      if (
        episode.dismissedAt &&
        trigger &&
        isWorseSeverity(severity, episode.dismissedAt, true) &&
        this.deps.countLocalAgentPanes() > 0
      ) {
        episode.dismissedAt = null
        this.record('reshown', reading, trigger, minutesToExhaustion, episode.id)
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
    // Why: the owner's rule is agents at risk; plain shells and builds alone do not warrant a popup.
    if (this.deps.countLocalAgentPanes() === 0) {
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
    this.warning = {
      episodeId: this.episodeId,
      reading,
      trigger,
      minutesToExhaustion,
      panes: [],
      sweeping: true
    }
    this.record('opened', reading, trigger, minutesToExhaustion, this.episodeId)
    await this.showAndSweep(this.episodeId)
  }

  private countLegacy(
    reading: MemoryPressureReading,
    thresholdPercent: number,
    minutesToExhaustion: number | null
  ): void {
    const elevated = isLegacyMemoryPressureElevated(reading, thresholdPercent, this.legacyElevated)
    if (elevated && !this.legacyElevated) {
      this.record('legacy-would-open', reading, null, minutesToExhaustion, null)
    }
    this.legacyElevated = elevated
  }

  private record(
    event: MemoryPressurePopupRecord['event'],
    reading: MemoryPressureReading,
    trigger: MemoryPressureTrigger | null,
    minutesToExhaustion: number | null,
    episodeId: number | null
  ): void {
    const swapUsedPercent =
      reading.swapTotal && reading.swapUsed !== null
        ? roundTenth((reading.swapUsed / reading.swapTotal) * 100)
        : null
    try {
      this.deps.recordPopup({
        event,
        at: reading.readAt,
        episodeId,
        trigger,
        source: reading.source,
        kernelLevel: reading.kernelLevel,
        availablePercent: roundTenth(availablePercentOf(reading)),
        swapUsedPercent,
        minutesToExhaustion:
          minutesToExhaustion === null ? null : roundTenth(Math.min(minutesToExhaustion, 9999)),
        agentPanes: this.deps.countLocalAgentPanes()
      })
    } catch {
      // The popup log is for comparison only; a failed write must not stop the warning.
    }
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
    this.legacyElevated = false
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
