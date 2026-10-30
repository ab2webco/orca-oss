import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { GAME_EVENT_KINDS, GAME_EVENT_TEXT_MAX } from '../../../../shared/orchestrator-game-events'
import {
  GAME_OWNER_CONTEXT_MAX,
  GAME_OWNER_OPTIONS_MAX,
  GAME_OWNER_OPTION_TEXT_MAX,
  GAME_OWNER_QUESTION_TEXT_MAX
} from '../../../../shared/orchestrator-game-owner-questions'

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

const GameInboxThreadsParams = z.object(Caller).optional()

const GameOwnerReplyToMemberParams = z.object({
  ...Caller,
  id: z.string().min(1).max(80),
  text: z.string().trim().min(1).max(GAME_OWNER_QUESTION_TEXT_MAX),
  ticket: z.string().max(40).optional()
})

const GameOwnerAskParams = z.object({
  ...Caller,
  ticket: z.string().max(40).optional(),
  question: z.string().min(1).max(GAME_OWNER_QUESTION_TEXT_MAX),
  options: z
    .array(z.string().min(1).max(GAME_OWNER_OPTION_TEXT_MAX))
    .max(GAME_OWNER_OPTIONS_MAX)
    .optional(),
  context: z.string().max(GAME_OWNER_CONTEXT_MAX).optional()
})

const GameOwnerQuestionsParams = z.object({ ...Caller, all: z.boolean().optional() }).optional()

// Why exactly one of option and text: the person picks a button or writes an answer.
const GameOwnerAnswerParams = z
  .object({
    ...Caller,
    id: z.string().min(1).max(40),
    option: z.number().int().min(1).max(GAME_OWNER_OPTIONS_MAX).optional(),
    text: z.string().min(1).max(GAME_OWNER_QUESTION_TEXT_MAX).optional()
  })
  .refine((params) => (params.option === undefined) !== (params.text === undefined), {
    message: 'Give either option or text.'
  })

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
    name: 'game.inboxThreads',
    params: GameInboxThreadsParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().inboxThreads({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle
      })
  }),
  defineMethod({
    name: 'game.ownerReplyToMember',
    params: GameOwnerReplyToMemberParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().replyToMember({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        id: params.id,
        text: params.text,
        ticket: params.ticket
      })
  }),
  defineMethod({
    name: 'game.ownerAsk',
    params: GameOwnerAskParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().askOwner({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        ticket: params.ticket,
        question: params.question,
        options: params.options,
        context: params.context
      })
  }),
  defineMethod({
    name: 'game.ownerQuestions',
    params: GameOwnerQuestionsParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().ownerQuestions({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle,
        all: params?.all
      })
  }),
  defineMethod({
    name: 'game.ownerAnswer',
    params: GameOwnerAnswerParams,
    handler: async (params, { runtime }) =>
      runtime.getGameBoard().answerOwner({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        id: params.id,
        option: params.option,
        text: params.text
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
