import { randomUUID } from 'node:crypto'
import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import type { GameHistoryStore } from './orchestrator-game-history-store'
import {
  addGameDecision,
  gameDecisionListOf,
  gameDecisionOf,
  settleGameFollowUp,
  type GameDecision,
  type GameDecisionDraft,
  type GameDecisionList,
  type GameFollowUpDone
} from '../../shared/orchestrator-game-decisions'

const listOf = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : [])

/**
 * The project's decision trail in its board file on the Orca host, so a lead started with --fresh
 * or after a compaction reads what the one before it decided (ORCA-1428).
 */
export class GameDecisionTrail {
  constructor(
    private readonly deps: {
      store: Pick<GameHistoryStore, 'changeDataField'>
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      now?: () => Date
    }
  ) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  private async leadKeyOf(caller: GameBoardCaller): Promise<string> {
    const project = await this.deps.projectOf(caller)
    if (project.isMember) {
      throw new Error('Only the lead records project decisions; a member tells its lead.')
    }
    return project.key
  }

  async add(
    caller: GameBoardCaller,
    draft: GameDecisionDraft
  ): Promise<{ decision: GameDecision }> {
    const key = await this.leadKeyOf(caller)
    const id = `dec_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const decision = gameDecisionOf(draft, { id, at: this.now() })
    return this.deps.store.changeDataField(key, 'decisions', (raw) => ({
      next: addGameDecision(listOf(raw), decision),
      result: { decision }
    }))
  }

  /** Any session of the project reads it: every lead, and a member its lead's. */
  async list(
    caller: GameBoardCaller & { ticket?: string; all?: boolean }
  ): Promise<GameDecisionList> {
    const { key } = await this.deps.projectOf(caller)
    return this.deps.store.changeDataField(key, 'decisions', (raw) => ({
      next: null,
      result: gameDecisionListOf(listOf(raw), caller)
    }))
  }

  async done(
    caller: GameBoardCaller & { id: string }
  ): Promise<{ decision: GameDecision; repeated: boolean }> {
    const key = await this.leadKeyOf(caller)
    const at = this.now()
    const outcome: GameFollowUpDone = await this.deps.store.changeDataField(
      key,
      'decisions',
      (raw) => {
        const settled = settleGameFollowUp(listOf(raw), caller.id, at)
        return { next: settled.kind === 'done' ? settled.list : null, result: settled }
      }
    )
    if (outcome.kind === 'not_found') {
      throw new Error(`No decision ${caller.id} is on record for this project.`)
    }
    if (outcome.kind === 'not_follow_up') {
      throw new Error(`${caller.id} is a decision, not a follow-up: there is nothing to close.`)
    }
    return { decision: outcome.decision, repeated: outcome.kind === 'repeated' }
  }
}
