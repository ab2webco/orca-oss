import type { TeamSection } from '../../../src/shared/team-panel-model-types'
import type { TeamWorkWords } from './team-work-words'

/** A section that is not ready says why in one line; null when there is nothing to say. */
export function teamSectionNote<T>(
  section: TeamSection<T>,
  errorTitle: string,
  words: TeamWorkWords
): string | null {
  switch (section.kind) {
    case 'loading':
      return words.loading
    case 'unavailable':
      return words.unavailable
    case 'error':
      return `${errorTitle} · ${section.message}`
    case 'ready':
      return null
  }
}
