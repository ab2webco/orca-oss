import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** What lead time measured: tickets from the game's events, PRs from the review provider. */
type LeadUnit = 'ticket' | 'PR'

/** The Metrics widget's words. */
export type MetricsWords = {
  merged: (total: number, days: number) => string
  /** `repo` absent when it does not fit; `game` is Orca Game's own events. */
  source: (
    kind: 'github' | 'gitlab' | 'game',
    repo: string | undefined,
    time: string,
    partial?: true
  ) => string
  /** On a Panel whose state carries no metrics: a member's, or an older host's. */
  missing: string
  mergedTitle: string
  leadTitle: string
  accountsTitle: string
  perDay: string
  peak: string
  median: string
  measured: (count: number, unit: LeadUnit) => string
  noneMeasured: (unit: LeadUnit) => string
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const sourceIn =
  (game: string, updated: string, partial: string): MetricsWords['source'] =>
  (kind, repo, time, isPartial) =>
    `${kind === 'game' ? game : kind === 'github' ? 'GitHub' : 'GitLab'}${repo ? ` ${repo}` : ''} · ${updated} ${time}${isPartial ? ` · ${partial}` : ''}`

const EN: MetricsWords = {
  merged: (total, days) => `${total} merged · ${days} days`,
  source: sourceIn('Orca Game events', 'updated', 'partial'),
  missing: "Metrics show in the lead's Panel, from an Orca Lab that sends them.",
  mergedTitle: 'Merged per day',
  leadTitle: 'Lead time',
  accountsTitle: 'Accounts',
  perDay: '/day',
  peak: 'peak',
  median: 'median',
  measured: (count, unit) => `${plural(count, unit, `${unit}s`)} measured`,
  noneMeasured: (unit) => `no ${unit} measured`
}

const ES: MetricsWords = {
  merged: (total, days) => `${total} fusionados · ${days} días`,
  source: sourceIn('eventos de Orca Game', 'actualizado', 'parcial'),
  missing: 'Las métricas se ven en el Panel del lead, con un Orca Lab que las envíe.',
  mergedTitle: 'Fusionados por día',
  leadTitle: 'Tiempo de entrega',
  accountsTitle: 'Cuentas',
  perDay: '/día',
  peak: 'pico',
  median: 'mediana',
  measured: (count, unit) => plural(count, `${unit} medido`, `${unit}s medidos`),
  noneMeasured: (unit) => `ningún ${unit} medido`
}

const WORDS: Readonly<Record<GameLocale, MetricsWords>> = { en: EN, es: ES }

export const metricsWords = (): MetricsWords => WORDS[gameLocale()]
