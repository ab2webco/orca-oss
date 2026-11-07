import type {
  TeamHost,
  TeamMachine,
  TeamMetrics,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'

// Why every figure nullable: null is "Orca has no data for it", which the page says in words.
export type TeamDisplayPage =
  | {
      id: 'summary'
      active: number
      alerts: number | null
      queued: number | null
      mergedToday: number | null
      mergedPerHour24h: number[] | null
      meters: {
        ciGreenPercent: number | null
        sessionPercent: number | null
        weeklyPercent: number | null
      }
    }
  | {
      id: 'delivery'
      merged7d: number | null
      days: { day: string; merged: number }[]
      leadTimeMedianMs: number | null
    }
  | {
      id: 'quality'
      ciGreenPercent: number | null
      ciGreenPerDay: number[] | null
      flakyChecks: number | null
    }
  | { id: 'machines'; rows: TeamDisplayMachine[] | null }
  | {
      id: 'usage'
      costPerDay: { amount: number; currency: string }[] | null
      accounts: { email: string; weeklyPercent: number | null }[] | null
    }

export type TeamDisplayPageId = TeamDisplayPage['id']

export type TeamDisplayMachine = {
  key: string
  host: TeamHost
  /** Null when the host is offline. */
  cpuPercent: number | null
  memoryPercent: number | null
  running: number
  cap: number | null
}

const percent = (part: number, whole: number): number =>
  Math.round(Math.min(1, Math.max(0, part / whole)) * 100)

function machineOf(one: TeamMachine): TeamDisplayMachine {
  const reading = one.reading.kind === 'ok' ? one.reading : null
  return {
    key: one.host.kind === 'local' ? 'local' : one.host.name,
    host: one.host,
    cpuPercent:
      reading && reading.loadAverage1m !== null && reading.cpuCoreCount > 0
        ? percent(reading.loadAverage1m, reading.cpuCoreCount)
        : null,
    memoryPercent:
      reading && reading.totalMemory > 0
        ? percent(reading.totalMemory - reading.availableMemory, reading.totalMemory)
        : null,
    running: one.running,
    cap: one.cap
  }
}

/** V28's Display pages, in its order, from the Team model only. */
export function teamDisplayPagesOf(model: TeamPanelGameModel): TeamDisplayPage[] {
  const metrics: TeamMetrics | null = model.metrics.kind === 'ready' ? model.metrics.value : null
  const week = metrics?.mergedPerDay.slice(-7) ?? []
  // Why the first: the host lists the active account first.
  const account = metrics?.accounts[0] ?? null
  return [
    {
      id: 'summary',
      active: model.members.length,
      alerts: model.inbox.kind === 'ready' ? model.inbox.value.forYou : null,
      queued: model.queue?.kind === 'ready' ? model.queue.value.length : null,
      mergedToday: metrics?.mergedPerDay.at(-1)?.merged ?? null,
      mergedPerHour24h: metrics?.mergedPerHour24h ?? null,
      meters: {
        ciGreenPercent: metrics?.ciGreenPercent ?? null,
        sessionPercent: account?.sessionPercent ?? null,
        weeklyPercent: account?.weeklyPercent ?? null
      }
    },
    {
      id: 'delivery',
      merged7d: metrics ? week.reduce((sum, one) => sum + one.merged, 0) : null,
      days: week,
      leadTimeMedianMs: metrics?.leadTimeMedianMs ?? null
    },
    {
      id: 'quality',
      ciGreenPercent: metrics?.ciGreenPercent ?? null,
      ciGreenPerDay: metrics?.ciGreenPerDay?.map((one) => one.percent) ?? null,
      flakyChecks: metrics?.flakyChecks ?? null
    },
    {
      id: 'machines',
      rows: model.machines?.kind === 'ready' ? model.machines.value.map(machineOf) : null
    },
    {
      id: 'usage',
      costPerDay: metrics?.costPerDay ?? null,
      accounts: metrics
        ? metrics.accounts.map((one) => ({ email: one.email, weeklyPercent: one.weeklyPercent }))
        : null
    }
  ]
}
