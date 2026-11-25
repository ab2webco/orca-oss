import { z } from 'zod'
import {
  GAME_DECISION_EVIDENCE_MAX,
  GAME_DECISION_TEXT_MAX
} from '../../../../shared/orchestrator-game-decisions'
import { defineMethod, type RpcMethod } from '../core'

const Caller = {
  worktreeId: z.string().optional(),
  terminalHandle: z.string().optional()
}

// Why only the decision required: clients and hosts update apart, so a field added later stays optional.
const GameDecisionAddParams = z.object({
  ...Caller,
  decision: z.string().trim().min(1).max(GAME_DECISION_TEXT_MAX),
  ticket: z.string().max(40).optional(),
  why: z.string().max(GAME_DECISION_TEXT_MAX).optional(),
  evidence: z.string().max(GAME_DECISION_EVIDENCE_MAX).optional(),
  followUp: z.boolean().optional()
})

const GameDecisionsParams = z
  .object({ ...Caller, ticket: z.string().max(40).optional(), all: z.boolean().optional() })
  .optional()

const GameDecisionDoneParams = z.object({ ...Caller, id: z.string().min(1).max(40) })

/** The project's decision trail and follow-ups (ORCA-1428); an older host answers method_not_found. */
export const ORCHESTRATOR_GAME_DECISION_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.decisionAdd',
    params: GameDecisionAddParams,
    handler: async ({ worktreeId, terminalHandle, ...draft }, { runtime }) =>
      runtime.getGameDecisions().add({ worktreeId, terminalHandle }, draft)
  }),
  defineMethod({
    name: 'game.decisions',
    params: GameDecisionsParams,
    handler: async (params, { runtime }) => runtime.getGameDecisions().list(params ?? {})
  }),
  defineMethod({
    name: 'game.decisionDone',
    params: GameDecisionDoneParams,
    handler: async (params, { runtime }) => runtime.getGameDecisions().done(params)
  })
]
