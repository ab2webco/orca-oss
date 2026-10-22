import type { MemoryPressureReading } from '../../../shared/memory-pressure-types'

const GIB = 1024 ** 3
const MIN_HEADROOM_BYTES = 2 * GIB
const MIN_HEADROOM_SHARE = 0.2
export const LOCAL_SETUP_HOST = 'local'
const DEFAULT_MAX_HOLD_MS = 20 * 60_000
const DEFAULT_RETRY_MS = 15_000

/** Room for one more `pnpm install`-sized setup. */
export function hasSetupHeadroom(reading: MemoryPressureReading): boolean {
  if (reading.source === 'fallback') {
    return true
  }
  // Why: macOS counts cache and compressed pages as unavailable, so its own pressure level decides.
  if (reading.source === 'sysctl') {
    return reading.kernelLevel !== 'warn' && reading.kernelLevel !== 'critical'
  }
  return reading.availableMemory >= setupHeadroomBytes(reading)
}

const setupHeadroomBytes = (reading: MemoryPressureReading): number =>
  Math.max(MIN_HEADROOM_BYTES, reading.totalMemory * MIN_HEADROOM_SHARE)

const gb = (bytes: number): string => `${(bytes / GIB).toFixed(1)} GB`

const memoryHoldOf = (reading: MemoryPressureReading): string =>
  reading.source === 'sysctl'
    ? `memory: macOS reports ${reading.kernelLevel} memory pressure`
    : `memory: ${gb(reading.availableMemory)} free, needs ${gb(setupHeadroomBytes(reading))}`

export type SetupAdmissionRequest = {
  /** Where the setup runs: `local`, or one key per SSH connection. */
  host: string
  taskId: string
  /** What another queued start is told it waits on. */
  label: string
  /** Runs a start that waited; it must call `release` once its setup is over. */
  start: (release: () => void) => void | Promise<void>
}

export type SetupAdmission =
  | { admitted: true; release: () => void }
  | { admitted: false; position: number; waitingOn: string }

export type QueuedSetupStart = {
  host: string
  taskId: string
  label: string
  position: number
  waitingOn: string
}

const queuedAdmission = (place: QueuedSetupStart): SetupAdmission => ({
  admitted: false,
  position: place.position,
  waitingOn: place.waitingOn
})

type Holder = { taskId: string; label: string; timer: ReturnType<typeof setTimeout> }

type Deps = {
  readMemory: () => Promise<MemoryPressureReading>
  maxHoldMs?: number
  retryMs?: number
}

/** One worktree setup in flight per host; the rest wait in order (ORCA-746). */
export class WorkerSetupAdmission {
  private readonly holders = new Map<string, Holder>()
  private readonly queues = new Map<string, SetupAdmissionRequest[]>()
  private readonly memoryHolds = new Map<string, string>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly draining = new Set<string>()

  constructor(private readonly deps: Deps) {}

  async admit(request: SetupAdmissionRequest): Promise<SetupAdmission> {
    const waiting = this.placeOf(request.host, request.taskId)
    if (waiting) {
      return queuedAdmission(waiting)
    }
    // Why read before checking: the check and the claim below then run in one tick.
    const memoryHold = await this.memoryHoldFor(request.host)
    if (!this.holders.has(request.host) && this.queueOf(request.host).length === 0 && !memoryHold) {
      return { admitted: true, release: this.claim(request) }
    }
    this.queueOf(request.host).push(request)
    if (memoryHold && !this.holders.has(request.host)) {
      this.memoryHolds.set(request.host, memoryHold)
      this.scheduleRetry(request.host)
    }
    return queuedAdmission(this.placeOf(request.host, request.taskId)!)
  }

  /** Tasks whose start holds a slot: starting, or running their setup. */
  startingTaskIds(): string[] {
    return [...this.holders.values()].map((holder) => holder.taskId)
  }

  queued(): QueuedSetupStart[] {
    return [...this.queues.keys()].flatMap((host) =>
      this.queueOf(host).map((one) => this.placeOf(host, one.taskId)!)
    )
  }

  private placeOf(host: string, taskId: string): QueuedSetupStart | undefined {
    const queue = this.queueOf(host)
    const index = queue.findIndex((one) => one.taskId === taskId)
    if (index === -1) {
      return undefined
    }
    const holder = this.holders.get(host)
    const waitingOn = holder?.label ?? this.memoryHolds.get(host) ?? 'the setup before it'
    return {
      host,
      taskId,
      label: queue[index].label,
      position: index + 1,
      waitingOn
    }
  }

  private queueOf(host: string): SetupAdmissionRequest[] {
    let queue = this.queues.get(host)
    if (!queue) {
      queue = []
      this.queues.set(host, queue)
    }
    return queue
  }

  private async memoryHoldFor(host: string): Promise<string | null> {
    if (host !== LOCAL_SETUP_HOST) {
      return null
    }
    const reading = await this.deps.readMemory().catch(() => null)
    return reading && !hasSetupHeadroom(reading) ? memoryHoldOf(reading) : null
  }

  private claim(request: SetupAdmissionRequest): () => void {
    const timer = setTimeout(() => release(), this.deps.maxHoldMs ?? DEFAULT_MAX_HOLD_MS)
    timer.unref?.()
    const holder: Holder = { taskId: request.taskId, label: request.label, timer }
    this.holders.set(request.host, holder)
    this.memoryHolds.delete(request.host)
    const release = (): void => {
      if (this.holders.get(request.host) !== holder) {
        return
      }
      clearTimeout(holder.timer)
      this.holders.delete(request.host)
      void this.drain(request.host)
    }
    return release
  }

  private scheduleRetry(host: string): void {
    if (this.retries.has(host)) {
      return
    }
    const timer = setTimeout(() => {
      this.retries.delete(host)
      void this.drain(host)
    }, this.deps.retryMs ?? DEFAULT_RETRY_MS)
    timer.unref?.()
    this.retries.set(host, timer)
  }

  private async drain(host: string): Promise<void> {
    if (this.draining.has(host) || this.holders.has(host) || this.queueOf(host).length === 0) {
      return
    }
    this.draining.add(host)
    try {
      const memoryHold = await this.memoryHoldFor(host)
      const next = this.queueOf(host)[0]
      if (this.holders.has(host) || !next) {
        return
      }
      if (memoryHold) {
        this.memoryHolds.set(host, memoryHold)
        this.scheduleRetry(host)
        return
      }
      this.queueOf(host).shift()
      const release = this.claim(next)
      // Why not awaited: a start that releases at once must find the drain free to run again.
      void Promise.resolve()
        .then(() => next.start(release))
        .catch(() => release())
    } finally {
      this.draining.delete(host)
    }
  }
}
