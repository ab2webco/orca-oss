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
    // Why two keys: the extraction check reads literal keys, not i18next plural suffixes.
    score:
      score === 1
        ? translate(`${KEY}.scoreOne`, '1 pt')
        : translate(`${KEY}.score`, '{{score}} pts', { score }),
    hint: translate(`${KEY}.hint`, 'Space or tap to jump'),
    held: translate(`${KEY}.held`, 'Paused · someone needs you'),
    over:
      score === 1
        ? translate(`${KEY}.overOne`, 'Game over · 1 pt')
        : translate(`${KEY}.over`, 'Game over · {{score}} pts', { score }),
    overHint: translate(`${KEY}.overHint`, 'Space or tap to go back to Claude')
  }
}

export const arcadeTabTitle = (): string => translate(`${KEY}.title`, 'Arcade')

export const arcadeCanvasLabel = (): string => translate(`${KEY}.canvasLabel`, 'Arcade game')
