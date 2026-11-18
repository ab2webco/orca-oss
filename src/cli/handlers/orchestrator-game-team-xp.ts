import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller, optionalText } from './orchestrator-game-board-call'
import type { GameTeamXp } from '../../shared/orchestrator-game-team-xp'

type GameXpResult = { added: number; teamXp: GameTeamXp }

function rewardsOf(raw: string | undefined): unknown[] | undefined {
  if (raw === undefined) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // Reported below.
  }
  throw new RuntimeClientError('invalid_argument', '--rewards is not a JSON list.')
}

export const formatGameXp = (result: GameXpResult): string =>
  [
    `Team XP: ${result.teamXp.total}${result.added > 0 ? ` (${result.added} new)` : ''}`,
    ...result.teamXp.recent.map((one) => `  ${one.xp < 0 ? one.xp : `+${one.xp}`} ${one.label}`)
  ].join('\n')

export const ORCHESTRATOR_GAME_TEAM_XP_HANDLERS: Record<string, CommandHandler> = {
  'game xp': async ({ flags, client, json }) => {
    const rewards = rewardsOf(optionalText(flags, 'rewards'))
    const response = await callGameBoard<GameXpResult>(
      client,
      'game.xp',
      { ...gameBoardCaller(), ...(rewards ? { rewards } : {}) },
      'team XP'
    )
    printResult(response, json, formatGameXp)
  }
}
