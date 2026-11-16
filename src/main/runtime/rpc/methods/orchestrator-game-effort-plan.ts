import { z } from 'zod'
import {
  GAME_PLAN_PHASES,
  gameEffortPlanOf
} from '../../../../shared/orchestrator-game-effort-plan'
import { defineMethod, type RpcMethod } from '../core'

const PlanPhase = z.object({
  phase: z.enum(GAME_PLAN_PHASES),
  model: z.string().min(1).max(64),
  effort: z.string().min(1).max(16),
  why: z.string().min(1).max(200)
})

const GameEffortPlanParams = z
  .object({
    worktreeId: z.string().optional(),
    terminalHandle: z.string().optional(),
    ticket: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/),
    /** Absent to read the plan; the lead's phases, in order, to replace it. */
    phases: z.array(PlanPhase).min(1).max(GAME_PLAN_PHASES.length).optional()
  })
  .transform(({ phases, ...rest }, ctx) => {
    if (!phases) {
      return rest
    }
    const plan = gameEffortPlanOf({ source: 'lead', kind: null, phases })
    if (!plan) {
      ctx.addIssue({ code: 'custom', message: 'The plan has a phase this Orca cannot read.' })
      return z.NEVER
    }
    return { ...rest, plan }
  })

/** A ticket's effort plan (ORCA-1242): the lead writes it, the lead and its members read it. */
export const ORCHESTRATOR_GAME_EFFORT_PLAN_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.effortPlan',
    params: GameEffortPlanParams,
    handler: (params, { runtime }) =>
      runtime.gameEffortPlan({
        worktreeId: params.worktreeId,
        terminalHandle: params.terminalHandle,
        ticket: params.ticket,
        ...('plan' in params ? { plan: params.plan } : {})
      })
  })
]
