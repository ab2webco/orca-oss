import type { GameLocale } from '../types'
import { gameLocale } from './game-strings'

/** The Metrics widget's words. */
export type MetricsWords = {
  merged: (total: number, days: number) => string
  /** `duration` is null when nothing in the window was measured. */
  leadTime: (duration: string | null, measured: number, unit: 'ticket' | 'PR') => string
  /** `repo` absent when it does not fit; `game` is Orca Game's own events. */
  source: (
    kind: 'github' | 'gitlab' | 'game',
    repo: string | undefined,
    time: string,
    partial?: true
  ) => string
  /** On a Panel whose state carries no metrics: a member's, or an older host's. */
  missing: string
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const sourceIn =
  (game: string, updated: string, partial: string): MetricsWords['source'] =>
  (kind, repo, time, isPartial) =>
    `${kind === 'game' ? game : kind === 'github' ? 'GitHub' : 'GitLab'}${repo ? ` ${repo}` : ''} · ${updated} ${time}${isPartial ? ` · ${partial}` : ''}`

const EN: MetricsWords = {
  merged: (total, days) => `${total} merged · ${days} days`,
  leadTime: (duration, measured, unit) =>
    duration === null
      ? `lead time — no ${unit} measured`
      : `lead time median ${duration} · ${plural(measured, unit, `${unit}s`)}`,
  source: sourceIn('Orca Game events', 'updated', 'partial'),
  missing: "Metrics show in the lead's Panel, from an Orca Lab that sends them."
}

const ES: MetricsWords = {
  merged: (total, days) => `${total} fusionados · ${days} días`,
  leadTime: (duration, measured, unit) =>
    duration === null
      ? `mediana de entrega — ningún ${unit} medido`
      : `mediana de entrega ${duration} · ${plural(measured, unit, `${unit}s`)}`,
  source: sourceIn('eventos de Orca Game', 'actualizado', 'parcial'),
  missing: 'Las métricas se ven en el Panel del lead, con un Orca Lab que las envíe.'
}

const WORDS: Readonly<Record<GameLocale, MetricsWords>> = { en: EN, es: ES }

export const metricsWords = (): MetricsWords => WORDS[gameLocale()]
