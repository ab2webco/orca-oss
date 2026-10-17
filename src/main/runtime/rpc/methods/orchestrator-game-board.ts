import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { GAME_EVENT_KINDS, GAME_EVENT_TEXT_MAX } from '../../../../shared/orchestrator-game-events'

// Why the caller's worktree or terminal: the board belongs to the lead's project, and a member's to its lead's.
const Caller = {
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional()
}

const GameEventPostParams = z.object({
  ...Caller,
  kind: z.enum(GAME_EVENT_KINDS),
  ticket: z.string().max(40).optional(),
  text: z.string().max(GAME_EVENT_TEXT_MAX).optional(),
  key: z.string().max(120).optional()
})

const GameEventsParams = z
  .object({
    ...Caller,
    ticket: z.string().max(40).optional(),
    since: z.string().max(40).optional()
  })
  .optional()

// Why set optional: without it the call only reads, so the mod can poll it like game.state.
const GameStopSwitchParams = z.object({ ...Caller, set: z.boolean().optional() })

const GameInboxParams = z
  .object({
    ...Caller,
    ticket: z.string().max(40).optional(),
    unread: z.boolean().optional(),
    markRead: z.boolean().optional()
  })
  .optional()

/** The project's shared board: events, the STOP switch and inboxes; newer than `game.history`. */
export const ORCHESTRATOR_GAME_BOARD_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.eventPost',
    params: GameEventPostParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().postEvent({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        kind: params.kind,
        ticket: params.ticket,
        text: params.text,
        key: params.key
      })
  }),
  defineMethod({
    name: 'game.stopSwitch',
    params: GameStopSwitchParams,
    handler: async (params, { runtime }) => {
      const board = runtime.getGameBoard()
      const caller = { worktreeId: params.worktreeId, terminalHandle: params.terminalHandle }
      if (params.set === undefined) {
        return board.stopState(caller)
      }
      return params.set ? board.setStop(caller) : board.clearStop(caller)
    }
  }),
  defineMethod({
    name: 'game.inbox',
    params: GameInboxParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().inbox({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle,
        ticket: params?.ticket,
        unread: params?.unread,
        markRead: params?.markRead
      })
  }),
  defineMethod({
    name: 'game.events',
    params: GameEventsParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().events({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle,
        ticket: params?.ticket,
        since: params?.since
      })
  })
]
