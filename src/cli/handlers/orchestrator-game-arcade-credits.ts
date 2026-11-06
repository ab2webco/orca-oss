import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller, optionalText } from './orchestrator-game-board-call'
import type { GameArcadeCredits } from '../../shared/orchestrator-game-arcade-credits'

type GameArcadeResult = { arcade: GameArcadeCredits | null; ok?: boolean; paid?: number }

const ACTIONS = new Set(['play', 'keep', 'migrate'])

const playsOf = (arcade: GameArcadeCredits | null): string =>
  arcade === null
    ? 'Saved arcade plays belong to the lead.'
    : `${arcade.credits} saved arcade ${arcade.credits === 1 ? 'play' : 'plays'}.`

export function formatGameArcade(action: string | undefined, result: GameArcadeResult): string {
  if (action === 'migrate') {
    return `Paid ${result.paid ?? 0} kept offers: ${playsOf(result.arcade)}`
  }
  if (action === 'play') {
    return result.ok ? `Played one: ${playsOf(result.arcade)}` : 'No saved play left.'
  }
  return action === 'keep' ? `Kept for later: ${playsOf(result.arcade)}` : playsOf(result.arcade)
}

export const ORCHESTRATOR_GAME_ARCADE_CREDIT_HANDLERS: Record<string, CommandHandler> = {
  'game arcade': async ({ flags, client, json }) => {
    const action = optionalText(flags, 'action')
    if (action !== undefined && !ACTIONS.has(action)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Unknown action "${action}": play, keep or migrate.`
      )
    }
    const offers = [
      ...new Set((optionalText(flags, 'offers') ?? '').split(',').map((one) => one.trim()))
    ].filter((one) => one !== '')
    if (action === 'migrate' && offers.length === 0) {
      throw new RuntimeClientError('invalid_argument', 'migrate needs --offers <id,id,...>.')
    }
    const response = await callGameBoard<GameArcadeResult>(
      client,
      'game.arcade',
      {
        ...gameBoardCaller(),
        ...(action ? { action } : {}),
        ...(action === 'migrate' ? { offers } : {})
      },
      'arcade'
    )
    printResult(response, json, (result) => formatGameArcade(action, result))
  }
}
