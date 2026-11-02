import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** The Metrics widget's words. */
export type MetricsWords = {
  merged: (total: number, days: number) => string
  /** On a Panel whose state carries no metrics: a member's, or an older host's. */
  missing: string
  mergedTitle: string
  leadTitle: string
  accountsTitle: string
  perDay: string
  peak: string
  median: string
  measured: (count: number) => string
  noneMeasured: string
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const EN: MetricsWords = {
  merged: (total, days) => `${total} merged · ${days} days`,
  missing: "Metrics show in the lead's Panel, from an Orca Lab that sends them.",
  mergedTitle: 'Merged per day',
  leadTitle: 'Lead time',
  accountsTitle: 'Accounts',
  perDay: '/day',
  peak: 'peak',
  median: 'median',
  measured: (count) => `${plural(count, 'ticket', 'tickets')} measured`,
  noneMeasured: 'no ticket measured'
}

const ES: MetricsWords = {
  merged: (total, days) => `${total} fusionados · ${days} días`,
  missing: 'Las métricas se ven en el Panel del lead, con un Orca Lab que las envíe.',
  mergedTitle: 'Fusionados por día',
  leadTitle: 'Tiempo de entrega',
  accountsTitle: 'Cuentas',
  perDay: '/día',
  peak: 'pico',
  median: 'mediana',
  measured: (count) => plural(count, 'ticket medido', 'tickets medidos'),
  noneMeasured: 'ningún ticket medido'
}

const WORDS: Readonly<Record<GameLocale, MetricsWords>> = { en: EN, es: ES }

export const metricsWords = (): MetricsWords => WORDS[gameLocale()]
