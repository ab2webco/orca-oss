import { z } from 'zod'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'
import { GAME_EVENT_KINDS, GAME_EVENT_TEXT_MAX } from '../../../../shared/orchestrator-game-events'
import {
  GAME_OWNER_CONTEXT_MAX,
  GAME_OWNER_OPTIONS_MAX,
  GAME_OWNER_OPTION_TEXT_MAX,
  GAME_OWNER_QUESTION_TEXT_MAX,
  GAME_OWNER_QUESTIONS_MAX,
  type GameOwnerAnswerVia
} from '../../../../shared/orchestrator-game-owner-questions'
import { DESKTOP_IPC_REQUEST_ID } from '../desktop-ipc-request-id'
import { GAME_ARCADE_ACTIONS } from '../../../../shared/orchestrator-game-arcade-credits'
import {
  GAME_REWARD_KINDS,
  GAME_REWARD_WEIGHT_MAX
} from '../../../../shared/orchestrator-game-reward-weights'

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

// Why the agent's worktree and host: they survive a restart, unlike its pane key (ORCA-943).
const GameFleetDropParams = z.object({
  ...Caller,
  agent: z.object({
    worktreeId: z.string().min(1).max(400),
    environmentId: z.string().min(1).max(400).nullable(),
    name: z.string().min(1).max(400),
    ticket: z.string().max(40).nullable()
  }),
  dropped: z.boolean()
})

const GameFleetForgetParams = z.object({
  ...Caller,
  agent: z.object({ paneKey: z.string().min(1).max(400), name: z.string().min(1).max(400) })
})

// Why set optional: without it the call only reads, so the mod can poll it like game.state.
const GameStopSwitchParams = z.object({ ...Caller, set: z.boolean().optional() })

// Why action optional: without it the call only reads, so a client polls it like game.state.
// Why a separate action: `migrate` carries the terminal's kept offer ids, which play and keep never do.
const GameArcadeParams = z
  .object({
    ...Caller,
    action: z.enum([...GAME_ARCADE_ACTIONS, 'migrate']).optional(),
    offers: z.array(z.string().min(1).max(200)).max(200).optional()
  })
  .refine((params) => params.action !== 'migrate' || params.offers !== undefined, {
    message: 'migrate needs the offers to pay',
    path: ['offers']
  })

// Why rewards optional: without them the call only reads the team's XP.
const GameXpAwardParams = z.object({
  ...Caller,
  rewards: z
    .array(
      z.object({
        id: z.string().min(1).max(400),
        kind: z.enum(GAME_REWARD_KINDS),
        xp: z.number().int().min(-GAME_REWARD_WEIGHT_MAX).max(GAME_REWARD_WEIGHT_MAX),
        label: z.string().max(200)
      })
    )
    .max(50)
    .optional()
})

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

// Why role: a remote member's lead is on another host, so this one finds no parent pane for it.
const GameOwnerQuestionParams = z.object({
  ...Caller,
  id: z.string().min(1).max(40),
  role: z.literal('member').optional()
})

// Why unknown items: the member's host parses each, so one from a newer build is dropped, not fatal.
const GameOwnerQuestionsImportParams = z.object({
  dispatchId: z.string().min(1).max(200),
  ticket: z.string().min(1).max(40),
  questions: z.array(z.unknown()).max(GAME_OWNER_QUESTIONS_MAX)
})

// Why from the transport, never a param: `game answer-owner` must not pass itself off as the Inbox.
function ownerAnswerViaOf(context: RpcContext): GameOwnerAnswerVia {
  if (context.clientKind === 'mobile') {
    return 'phone'
  }
  return context.clientKind === 'runtime' || context.requestId === DESKTOP_IPC_REQUEST_ID
    ? 'inbox'
    : 'cli'
}

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
      const result = await (params.set ? board.setStop(caller) : board.clearStop(caller))
      runtime.noteGameFleetChanged()
      return result
    }
  }),
  defineMethod({
    name: 'game.arcade',
    params: GameArcadeParams,
    handler: async (params, { runtime }) => {
      const ledger = runtime.getGameArcade()
      const caller = { worktreeId: params.worktreeId, terminalHandle: params.terminalHandle }
      if (params.action === undefined) {
        return { arcade: await ledger.read(caller) }
      }
      return params.action === 'migrate'
        ? ledger.migrate(caller, params.offers ?? [])
        : ledger.apply(caller, params.action)
    }
  }),
  defineMethod({
    name: 'game.xp',
    params: GameXpAwardParams,
    handler: async (params, { runtime }) => {
      const ledger = runtime.getGameTeamXp()
      const caller = { worktreeId: params.worktreeId, terminalHandle: params.terminalHandle }
      if (!params.rewards?.length) {
        return { added: 0, teamXp: await ledger.read(caller) }
      }
      const result = await ledger.award(caller, params.rewards)
      if (result.added > 0) {
        runtime.noteGameFleetChanged()
      }
      return result
    }
  }),
  defineMethod({
    name: 'game.fleetDrop',
    params: GameFleetDropParams,
    handler: async (params, { runtime }) => runtime.setGameAgentDropped(params)
  }),
  defineMethod({
    name: 'game.fleetForget',
    params: GameFleetForgetParams,
    handler: async (params, { runtime }) => runtime.forgetGameAgent(params)
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
    name: 'game.ownerQuestion',
    params: GameOwnerQuestionParams,
    handler: async (params, { runtime }) => runtime.readGameOwnerQuestion(params)
  }),
  // Why the caller's fingerprint: only the lead's paired host may write what its member checks.
  defineMethod({
    name: 'game.ownerQuestionsImport',
    params: GameOwnerQuestionsImportParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint }) =>
      runtime.keepGameOwnerAnswersFromLeadHost(params, authenticatedCallerFingerprint)
  }),
  // Why no caller: the person's app shows every project's questions, not one worktree's.
  defineMethod({
    name: 'game.ownerQuestionsAll',
    params: z.object({}).optional(),
    handler: async (_params, { runtime }) => ({
      projects: await runtime.listGameOwnerQuestionProjects()
    })
  }),
  defineMethod({
    name: 'game.ownerAnswer',
    params: GameOwnerAnswerParams,
    handler: async (params, context) =>
      context.runtime.getGameBoard().answerOwner({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        id: params.id,
        option: params.option,
        text: params.text,
        via: ownerAnswerViaOf(context)
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
