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

// Why a JSON list too: the mod's offer ids end in a worktree path, which may hold a comma.
function offersOf(raw: string | undefined): string[] {
  let listed: unknown[] = (raw ?? '').split(',')
  if (raw?.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      listed = Array.isArray(parsed) ? parsed : []
    } catch {
      throw new RuntimeClientError('invalid_argument', '--offers is not a valid JSON list.')
    }
  }
  const ids = listed.flatMap((one) =>
    typeof one === 'string' && one.trim() !== '' ? [one.trim()] : []
  )
  return [...new Set(ids)]
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
    const offers = offersOf(optionalText(flags, 'offers'))
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
