// Mirrors Orca's src/shared/orchestrator-game-host-capacity.ts, which the mod cannot import.
import type { GameHostCapacity, GameLocale, GameState } from '../types'
import { isShape, str, type Shape } from './game-state-shapes'
import { gameLocale } from './game-strings'

type Words = {
  running: (count: string) => string
  cores: (count: number) => string
  free: (free: string, total: string) => string
  load: (load: string) => string
  lowMemory: string
  busy: string
  silent: string
}

const WORDS: Readonly<Record<GameLocale | 'compact', Words>> = {
  en: {
    running: (count) => `${count} running`,
    cores: (count) => `${count} cores`,
    free: (free, total) => `${free} of ${total} GB free`,
    load: (load) => `load ${load}`,
    lowMemory: 'low memory',
    busy: 'busy',
    silent: 'not answering'
  },
  es: {
    running: (count) => `${count} activos`,
    cores: (count) => `${count} núcleos`,
    free: (free, total) => `${free} de ${total} GB libres`,
    load: (load) => `carga ${load}`,
    lowMemory: 'poca memoria',
    busy: 'ocupado',
    silent: 'no responde'
  },
  // Why marks: a phone's Panel keeps every figure on one row in either language.
  compact: {
    running: (count) => `${count}▸`,
    cores: (count) => `${count}c`,
    free: (free, total) => `${free}/${total}G`,
    load: (load) => `L${load}`,
    lowMemory: '!mem',
    busy: '!cpu',
    silent: '?'
  }
}

const GB = 1024 ** 3
const MAX_HOSTS = 16

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const hostOf = (value: unknown): GameHostCapacity[] => {
  const host = isShape(value) ? str(value.host) : undefined
  const running = isShape(value) ? count(value.running) : undefined
  if (!isShape(value) || host === undefined || running === undefined) {
    return []
  }
  const cap = count(value.cap)
  const head = { host, running, ...(cap ? { cap } : {}) }
  if (value.status === 'unreachable') {
    return [{ ...head, status: 'unreachable' }]
  }
  const [cpuCoreCount, totalMemory, availableMemory] = [
    value.cpuCoreCount,
    value.totalMemory,
    value.availableMemory
  ].map(count)
  if (value.status !== 'ok' || !cpuCoreCount || !totalMemory || availableMemory === undefined) {
    return []
  }
  const loadAverage1m = count(value.loadAverage1m) ?? null
  return [{ ...head, status: 'ok', cpuCoreCount, totalMemory, availableMemory, loadAverage1m }]
}

/** Each host Orca publishes for a lead with a paired host (ORCA-841); absent otherwise. */
export const hostCapacityOf = (body: Shape): Pick<GameState, 'hostCapacity'> =>
  Array.isArray(body.hostCapacity)
    ? { hostCapacity: body.hostCapacity.slice(0, MAX_HOSTS).flatMap(hostOf) }
    : {}

const gbOf = (bytes: number): string =>
  bytes < 10 * GB ? (bytes / GB).toFixed(1) : String(Math.round(bytes / GB))

export type HostCapacityLine = { key: string; text: string; warn: boolean }

/** One line per host, flagged as Orca's `game fleet` flags it; `compact` for a phone. */
export function hostCapacityLinesOf(
  hosts: readonly GameHostCapacity[],
  compact: boolean
): HostCapacityLine[] {
  const words = WORDS[compact ? 'compact' : gameLocale()]
  return hosts.map((one) => {
    const running = words.running(one.cap ? `${one.running}/${one.cap}` : String(one.running))
    const lineOf = (parts: string[], warn: boolean): HostCapacityLine => ({
      key: one.host,
      text: `⌂ ${one.host} ${[running, ...parts].join(compact ? ' ' : ' · ')}`,
      warn
    })
    if (one.status === 'unreachable') {
      return lineOf([words.silent], true)
    }
    const low = one.availableMemory < 4 * GB || one.availableMemory < one.totalMemory * 0.1
    const busy = one.loadAverage1m !== null && one.loadAverage1m >= one.cpuCoreCount
    const load = one.loadAverage1m === null ? [] : [words.load(one.loadAverage1m.toFixed(1))]
    return lineOf(
      [
        words.cores(one.cpuCoreCount),
        words.free(gbOf(one.availableMemory), gbOf(one.totalMemory)),
        ...load,
        ...(low ? [words.lowMemory] : []),
        ...(busy ? [words.busy] : [])
      ],
      low || busy
    )
  })
}
