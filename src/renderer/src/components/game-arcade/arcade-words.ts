import { translate } from '@/i18n/i18n'
import type { OrchestratorGameArcadeEngine } from '../../../../shared/orchestrator-game-arcade-file'
/** The lines the canvas draws over the run. */
export type ArcadeWords = {
  score: string
  hint: string
  held: string
  over: string
  overHint: string
}

const KEY = 'auto.components.game-arcade.ArcadeTab'

const hintOf = (engine: OrchestratorGameArcadeEngine): string => {
  switch (engine) {
    case 'runner':
      return translate(`${KEY}.hint`, 'Space or tap to jump')
    case 'snake':
      return translate(`${KEY}.snakeHint`, 'Arrows, WASD or tap to steer')
    case 'bricks':
      return translate(`${KEY}.bricksHint`, 'Arrows, A/D or the mouse to move the paddle')
    case 'defense':
      return translate(`${KEY}.defenseHint`, 'Arrows or A/D to move, Space or tap to fire')
  }
}

/** Version 28's arcade copy; the held line is ours, since the prototype never pauses. */
export function arcadeWordsOf(
  score: number,
  /** Who the run waits on; empty when the pane has no name to show. */
  heldBy = '',
  engine: OrchestratorGameArcadeEngine = 'runner'
): ArcadeWords {
  return {
    // Why two keys: the extraction check reads literal keys, not i18next plural suffixes.
    score:
      score === 1
        ? translate(`${KEY}.scoreOne`, '1 pt')
        : translate(`${KEY}.score`, '{{score}} pts', { score }),
    hint: hintOf(engine),
    held: heldBy
      ? translate(`${KEY}.heldBy`, 'Paused · {{name}} needs you', { name: heldBy })
      : translate(`${KEY}.held`, 'Paused · someone needs you'),
    over:
      score === 1
        ? translate(`${KEY}.overOne`, 'Game over · 1 pt')
        : translate(`${KEY}.over`, 'Game over · {{score}} pts', { score }),
    overHint: translate(`${KEY}.overHint`, 'Space or tap to go back to Claude')
  }
}

export const arcadeTabTitle = (): string => translate(`${KEY}.title`, 'Arcade')

export const arcadeCanvasLabel = (): string => translate(`${KEY}.canvasLabel`, 'Arcade game')
