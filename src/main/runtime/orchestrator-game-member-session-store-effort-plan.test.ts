import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import {
  gameKindEffortPlanOf,
  type GameEffortPlan
} from '../../shared/orchestrator-game-effort-plan'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function store(): GameMemberSessionStore {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-plan-'))
  dirs.push(dir)
  return new GameMemberSessionStore(() => dir)
}

const leadPlan: GameEffortPlan = {
  source: 'lead',
  kind: null,
  phases: [{ phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'read first' }]
}

describe("a ticket's effort plan in the members store (ORCA-1242)", () => {
  it('writes the lead plan over the seeded one and reads it back by ticket in any case', async () => {
    const members = store()
    await members.upsert('repo:1', {
      ticket: 'ORCA-7',
      runId: 'run_1',
      taskId: 'task_7',
      effortPlan: gameKindEffortPlanOf('implement')
    })

    await expect(members.writeEffortPlan('repo:1', 'orca-7', leadPlan)).resolves.toEqual(leadPlan)
    await expect(members.effortPlanOf('repo:1', 'ORCA-7')).resolves.toEqual({
      known: true,
      plan: leadPlan
    })
  })

  it('says when the ticket has no saved member, instead of keeping a plan nobody launched', async () => {
    const members = store()
    await expect(members.writeEffortPlan('repo:1', 'ORCA-8', leadPlan)).rejects.toThrow(
      'No member is saved for ORCA-8 in this project'
    )
    await expect(members.effortPlanOf('repo:1', 'ORCA-8')).resolves.toEqual({
      known: false,
      plan: null
    })
  })

  it('reads a member launched before plans existed as known with no plan', async () => {
    const members = store()
    await members.upsert('repo:1', { ticket: 'ORCA-9', runId: 'run_1', taskId: 'task_9' })
    await expect(members.effortPlanOf('repo:1', 'ORCA-9')).resolves.toEqual({
      known: true,
      plan: null
    })
  })
})
