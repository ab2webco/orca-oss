import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** The Metrics widget's words. */
export type MetricsWords = {
  merged: (total: number, days: number) => string
  /** `duration` is null when nothing in the window was measured; `reviews` counts PRs, not tickets. */
  leadTime: (duration: string | null, measured: number, reviews: boolean) => string
  /** `repo` is null when it does not fit; `game` is Orca Game's own events. */
  source: (
    kind: 'github' | 'gitlab' | 'game',
    repo: string | null,
    time: string,
    partial: boolean
  ) => string
  /** On a Panel whose state carries no metrics: a member's, or an older host's. */
  missing: string
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const PROVIDERS = { github: 'GitHub', gitlab: 'GitLab' } as const

const sourceIn =
  (game: string, updated: string, partial: string): MetricsWords['source'] =>
  (kind, repo, time, isPartial) =>
    [
      `${kind === 'game' ? game : PROVIDERS[kind]}${repo ? ` ${repo}` : ''}`,
      `${updated} ${time}`,
      ...(isPartial ? [partial] : [])
    ].join(' · ')

const EN: MetricsWords = {
  merged: (total, days) => `${total} merged · ${days} days`,
  leadTime: (duration, measured, reviews) =>
    duration === null
      ? `lead time — no ${reviews ? 'PR' : 'ticket'} measured`
      : `lead time median ${duration} · ${reviews ? plural(measured, 'PR', 'PRs') : plural(measured, 'ticket', 'tickets')}`,
  source: sourceIn('Orca Game events', 'updated', 'partial'),
  missing: "Metrics show in the lead's Panel, from an Orca Lab that sends them."
}

const ES: MetricsWords = {
  merged: (total, days) => `${total} fusionados · ${days} días`,
  leadTime: (duration, measured, reviews) =>
    duration === null
      ? `mediana de entrega — ningún ${reviews ? 'PR' : 'ticket'} medido`
      : `mediana de entrega ${duration} · ${reviews ? plural(measured, 'PR', 'PRs') : plural(measured, 'ticket', 'tickets')}`,
  source: sourceIn('eventos de Orca Game', 'actualizado', 'parcial'),
  missing: 'Las métricas se ven en el Panel del lead, con un Orca Lab que las envíe.'
}

const WORDS: Readonly<Record<GameLocale, MetricsWords>> = { en: EN, es: ES }

export const metricsWords = (): MetricsWords => WORDS[gameLocale()]
