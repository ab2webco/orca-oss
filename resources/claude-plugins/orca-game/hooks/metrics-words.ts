import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** The Metrics widget's words. */
export type MetricsWords = {
  merged: (total: number, days: number) => string
  /** `duration` is null when no ticket in the window was measured. */
  leadTime: (duration: string | null, measured: number) => string
  /** On a Panel whose state carries no metrics: a member's, or an older host's. */
  missing: string
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const EN: MetricsWords = {
  merged: (total, days) => `${total} merged · ${days} days`,
  leadTime: (duration, measured) =>
    duration === null
      ? 'lead time — no ticket measured'
      : `lead time median ${duration} · ${plural(measured, 'ticket', 'tickets')}`,
  missing: "Metrics show in the lead's Panel, from an Orca Lab that sends them."
}

const ES: MetricsWords = {
  merged: (total, days) => `${total} fusionados · ${days} días`,
  leadTime: (duration, measured) =>
    duration === null
      ? 'mediana de entrega — ningún ticket medido'
      : `mediana de entrega ${duration} · ${plural(measured, 'ticket', 'tickets')}`,
  missing: 'Las métricas se ven en el Panel del lead, con un Orca Lab que las envíe.'
}

const WORDS: Readonly<Record<GameLocale, MetricsWords>> = { en: EN, es: ES }

export const metricsWords = (): MetricsWords => WORDS[gameLocale()]
