import { translate } from '@/i18n/i18n'
/** The lines the canvas draws over the run. */
export type ArcadeWords = {
  score: string
  hint: string
  held: string
  over: string
  overHint: string
}

const KEY = 'auto.components.game-arcade.ArcadeTab'

/** Version 28's arcade copy; the held line is ours, since the prototype never pauses. */
export function arcadeWordsOf(score: number): ArcadeWords {
  return {
    score: translate(`${KEY}.score`, '{{count}} pts', { count: score }),
    hint: translate(`${KEY}.hint`, 'Space or tap to jump'),
    held: translate(`${KEY}.held`, 'Paused · someone needs you'),
    over: translate(`${KEY}.over`, 'Game over · {{count}} pts', { count: score }),
    overHint: translate(`${KEY}.overHint`, 'Space or tap to go back to Claude')
  }
}

export const arcadeTabTitle = (): string => translate(`${KEY}.title`, 'Arcade')

export const arcadeCanvasLabel = (): string => translate(`${KEY}.canvasLabel`, 'Arcade game')
