import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller, optionalText } from './orchestrator-game-board-call'
import type { GameInbox } from '../../shared/orchestrator-game-inbox'

export type GameInboxResult = { inbox: GameInbox }

export function formatGameInbox({ inbox }: GameInboxResult): string {
  const head = `${inbox.key} inbox: ${inbox.unread} unread`
  if (inbox.messages.length === 0) {
    return `${head}, no messages.`
  }
  return [
    head,
    ...inbox.messages.map(
      (one) =>
        `${one.unread ? '*' : ' '} ${one.at} ${one.from} ${one.type}: ${(one.body || one.subject).replace(/\s+/g, ' ')}`
    )
  ].join('\n')
}

export type GameInboxSettleResult = {
  settled: { id: string; subject: string; stuck: string | null }
  noteId: string
}

export const formatGameInboxSettle = ({ settled, noteId }: GameInboxSettleResult): string =>
  `Settled ${settled.id} ("${settled.subject}"): it no longer waits on the lead. Audit note ${noteId}.`

export const ORCHESTRATOR_GAME_INBOX_HANDLERS: Record<string, CommandHandler> = {
  'game inbox': async ({ flags, client, json }) => {
    const settle = optionalText(flags, 'settle')
    if (settle === undefined && !flags.has('settle') && flags.has('note')) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--note goes with --settle: orca game inbox --settle <msg> --note "<why>"'
      )
    }
    if (settle !== undefined || flags.has('settle')) {
      const note = optionalText(flags, 'note')
      if (!settle || !note) {
        throw new RuntimeClientError(
          'invalid_argument',
          'Settle one message with why: orca game inbox --settle <msg> --note "<why>"'
        )
      }
      const response = await callGameBoard<GameInboxSettleResult>(
        client,
        'game.inboxSettle',
        { ...gameBoardCaller(), id: settle, note },
        'inbox settle'
      )
      printResult(response, json, formatGameInboxSettle)
      return
    }
    const ticket = optionalText(flags, 'ticket')?.toUpperCase()
    const response = await callGameBoard<GameInboxResult>(
      client,
      'game.inbox',
      {
        ...gameBoardCaller(),
        ...(ticket ? { ticket } : {}),
        ...(flags.get('unread') === true ? { unread: true } : {}),
        ...(flags.get('mark-read') === true ? { markRead: true } : {})
      },
      'inbox'
    )
    printResult(response, json, formatGameInbox)
  }
}
