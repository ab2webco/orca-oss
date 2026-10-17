import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { isHttpUrl } from '../../../../shared/orchestrator-game-integrations'
import {
  parseGameHistoryRecord,
  type GameHistoryRecord
} from '../../../../shared/orchestrator-game-history'

const GameStateParams = z
  .object({
    worktreeId: z.string().optional(),
    terminalHandle: z.string().optional(),
    paneKey: z.string().optional(),
    // Why unknown: a report this host cannot read must cost the member its Jev row, never its state.
    advisor: z.unknown().optional()
  })
  .optional()

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
  record: GameHistoryRecordSchema
})

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
    name: 'game.historyRecord',
    params: GameHistoryRecordParams,
    handler: async (params, { runtime }) =>
      runtime.recordGameHistory({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        memberWorktreeId: params.memberWorktreeId,
        record: params.record
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
      runtime.getOrchestratorGameState({
        worktreeId: params?.worktreeId,
        terminalHandle: params?.terminalHandle,
        paneKey: params?.paneKey,
        advisor: params?.advisor
      })
  })
]
