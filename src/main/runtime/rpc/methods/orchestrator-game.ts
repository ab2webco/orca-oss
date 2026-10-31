import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { isHttpUrl } from '../../../../shared/orchestrator-game-integrations'
import {
  ORCHESTRATOR_GAME_VIEWS,
  ORCHESTRATOR_GAME_VIEW_SCOPES
} from '../../../../shared/orchestrator-game-view'
import {
  parseGameHistoryRecord,
  type GameHistoryRecord
} from '../../../../shared/orchestrator-game-history'
import { withGameAutoRelease } from './orchestrator-game-auto-release'

const GameStateParams = z
  .object({
    worktreeId: z.string().optional(),
    terminalHandle: z.string().optional(),
    paneKey: z.string().optional(),
    // Why unknown: a report this host cannot read must cost the member its Jev row, never its state.
    advisor: z.unknown().optional()
  })
  .optional()

const GameSetViewParams = z.object({
  view: z.enum(ORCHESTRATOR_GAME_VIEWS.map((view) => view.id)),
  scope: z.enum(ORCHESTRATOR_GAME_VIEW_SCOPES),
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional()
})

// Why http(s) only: any CLI caller reaches this, and it opens on the person's desktop.
const GameOpenLinkParams = z.object({
  url: z.string().max(2048).refine(isHttpUrl, 'Only http(s) links open in the system browser.')
})

const GameHistoryRecordSchema = z.unknown().transform((value, ctx): GameHistoryRecord => {
  const record = parseGameHistoryRecord(value)
  if (!record) {
    ctx.addIssue({ code: 'custom', message: 'Malformed game history record.' })
    return z.NEVER
  }
  return record
})

// Why the caller's worktree or terminal: the record belongs to the lead's project.
const GameHistoryRecordParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  memberWorktreeId: z.string().optional(),
  record: GameHistoryRecordSchema,
  character: z.string().max(64).optional(),
  /** The roster key of `character`, so its language variants count as one character. */
  characterKey: z.string().max(64).optional()
})

const memberText = z.string().min(1).max(200).optional()

// Why not strict: a newer CLI may send fields this host does not keep yet.
const GameMemberRecordParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  member: z.object({
    ticket: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/),
    name: memberText,
    runId: memberText,
    taskId: memberText,
    dispatchId: memberText,
    worktreeId: memberText,
    agent: memberText,
    accountId: memberText,
    account: memberText,
    lastState: memberText
  })
})

const TicketParam = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/)

const GameMemberResumeParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  ticket: TicketParam
})

const GameMemberWakeParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  dispatchId: z.string().min(1).max(200)
})

const GameMemberDiscardParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  tickets: z.union([z.array(TicketParam).min(1).max(50), z.literal('all')])
})

const rosterName = z.string().min(1).max(64)

// Why loose bounds: a contributed scene's roster is not held to the memberNames limits.
const GameMemberNameReserveParams = z.object({
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional(),
  ticket: TicketParam,
  roster: z
    .array(z.union([rosterName, z.object({ en: rosterName, es: rosterName.optional() })]))
    .max(200),
  locale: z.string().max(16),
  taken: z.array(z.string().max(200)).max(500)
})

const GameCallerParams = z
  .object({ worktreeId: z.string().optional(), terminalHandle: z.string().optional() })
  .optional()

const GameHistoryParams = z
  .object({
    worktreeId: z.string().optional(),
    terminalHandle: z.string().optional(),
    ticket: z.string().max(40).optional(),
    since: z.string().max(40).optional()
  })
  .optional()

export const ORCHESTRATOR_GAME_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.openLink',
    params: GameOpenLinkParams,
    handler: async (params, { runtime }) => runtime.openGameLinkInSystemBrowser(params.url)
  }),
  defineMethod({
    name: 'game.setView',
    params: GameSetViewParams,
    handler: async (params, { runtime }) =>
      runtime.setOrchestratorGameView({
        view: params.view,
        scope: params.scope,
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle
      })
  }),
  defineMethod({
    name: 'game.historyRecord',
    params: GameHistoryRecordParams,
    handler: async (params, { runtime }) =>
      runtime.recordGameHistory({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        memberWorktreeId: params.memberWorktreeId,
        record: params.record,
        character: params.character,
        characterKey: params.characterKey
      })
  }),
  defineMethod({
    name: 'game.memberRecord',
    params: GameMemberRecordParams,
    handler: async (params, { runtime }) =>
      runtime.recordGameMember({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        member: params.member
      })
  }),
  defineMethod({
    name: 'game.memberNameReserve',
    params: GameMemberNameReserveParams,
    handler: async (params, { runtime }) => runtime.reserveGameMemberName(params)
  }),
  defineMethod({
    name: 'game.memberResume',
    params: GameMemberResumeParams,
    handler: async (params, { runtime }) =>
      runtime.resumeGameMember({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        ticket: params.ticket
      })
  }),
  defineMethod({
    name: 'game.memberWake',
    params: GameMemberWakeParams,
    handler: async (params, { runtime }) => ({
      wake: await runtime.wakeGameMember({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        dispatchId: params.dispatchId
      })
    })
  }),
  defineMethod({
    name: 'game.memberDiscard',
    params: GameMemberDiscardParams,
    handler: async (params, { runtime }) =>
      runtime.discardGameMembers({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        tickets: params.tickets
      })
  }),
  defineMethod({
    name: 'game.lessons',
    params: GameCallerParams,
    handler: async (params, { runtime }) =>
      runtime.listGameLessons({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle
      })
  }),
  defineMethod({
    name: 'game.characters',
    params: GameCallerParams,
    handler: async (params, { runtime }) =>
      runtime.listGameCharacters({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle
      })
  }),
  defineMethod({
    name: 'game.history',
    params: GameHistoryParams,
    handler: async (params, { runtime }) =>
      runtime.listGameHistory({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle,
        ticket: params?.ticket,
        since: params?.since
      })
  }),
  defineMethod({
    name: 'game.state',
    params: GameStateParams,
    handler: async (params, { runtime }) =>
      withGameAutoRelease(
        runtime,
        await runtime.getOrchestratorGameState({
          worktreeId: params?.worktreeId,
          terminalHandle: params?.terminalHandle,
          paneKey: params?.paneKey,
          advisor: params?.advisor
        }),
        { worktreeId: params?.worktreeId, terminalHandle: params?.terminalHandle }
      )
  })
]
