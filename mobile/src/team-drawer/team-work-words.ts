import type { TeamPrRow, TeamQueueEntry } from '../../../src/shared/team-panel-model-types'
import type { SupportedUiLocale } from '../../../src/shared/ui-locale'

type Words = {
  prs: string
  mergeQueue: string
  openPrs: string
  viewAll: (count: number) => string
  reason: Record<TeamPrRow['reason'], string>
  queue: Record<TeamQueueEntry['state'], string>
  longWait: (hours: number) => string
  noPrs: string
  prsError: string
  queueError: string
  unavailable: string
  loading: string
  providerFailed: string
  githubLimit: (minutes: number) => string
}

// Why these words: they match desktop's teamPanel catalog, so both surfaces say the same.
const WORDS: Record<SupportedUiLocale, Words> = {
  en: {
    prs: 'PRs',
    mergeQueue: 'Merge queue',
    openPrs: 'Open PRs',
    viewAll: (count) => `View all ${count}`,
    reason: {
      checksFailed: 'Check failed',
      checksUnknown: 'CI unknown',
      conflict: 'Conflict',
      inReview: 'In review',
      ready: 'Ready',
      draft: 'Draft',
      merged: 'Merged',
      closed: 'Closed'
    },
    queue: { checks: 'In checks', waiting: 'In queue', failed: 'Failed' },
    longWait: (hours) => `For ${hours} h`,
    noPrs: 'No open pull requests',
    prsError: 'Could not read pull requests',
    queueError: 'Could not read the queue',
    unavailable: 'This Orca host does not publish it yet.',
    loading: 'Loading',
    providerFailed: 'The provider did not answer. It retries on its own.',
    githubLimit: (minutes) => `GitHub API limit reached. It retries on its own in ${minutes} min.`
  },
  es: {
    prs: 'PRs',
    mergeQueue: 'Cola de merge',
    openPrs: 'PRs abiertos',
    viewAll: (count) => `Ver los ${count}`,
    reason: {
      checksFailed: 'Check falló',
      checksUnknown: 'CI desconocido',
      conflict: 'Conflicto',
      inReview: 'En revisión',
      ready: 'Listo',
      draft: 'Borrador',
      merged: 'Fusionado',
      closed: 'Cerrado'
    },
    queue: { checks: 'En checks', waiting: 'En cola', failed: 'Falló' },
    longWait: (hours) => `Lleva ${hours} h`,
    noPrs: 'No hay pull requests abiertos',
    prsError: 'No se pudieron leer los pull requests',
    queueError: 'No se pudo leer la cola',
    unavailable: 'Este host de Orca todavía no lo publica.',
    loading: 'Cargando',
    providerFailed: 'El proveedor no respondió. Se reintenta solo.',
    githubLimit: (minutes) =>
      `Límite de la API de GitHub alcanzado. Se reintenta solo en ${minutes} min.`
  }
}

export const teamWorkWordsOf = (locale: SupportedUiLocale): Words => WORDS[locale]
export type TeamWorkWords = Words
