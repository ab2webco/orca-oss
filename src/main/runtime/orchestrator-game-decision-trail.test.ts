import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import { GameDecisionTrail } from './orchestrator-game-decision-trail'
import { GameHistoryStore } from './orchestrator-game-history-store'
import { GameTeamXpLedger } from './orchestrator-game-team-xp-ledger'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-decisions-'))
  dirs.push(dir)
  return dir
}

// Why handles: the lead before and after a rotation are different terminals of one project.
function projectOf(caller: GameBoardCaller): Promise<GameBoardProject> {
  const isMember = caller.terminalHandle === 'term_member'
  return Promise.resolve({
    key: 'repo:r1',
    isMember,
    memberTicket: isMember ? 'ORCA-7' : null,
    lead: null
  })
}

function trailIn(dir: string, second = 0) {
  return new GameDecisionTrail({
    store: new GameHistoryStore(() => dir),
    projectOf,
    now: () => new Date(Date.UTC(2026, 10, 25, 10, 0, second))
  })
}

describe('GameDecisionTrail', () => {
  it('a lead started fresh on a restarted host reads the rows the lead before it recorded', async () => {
    const dir = tempDir()
    const old = trailIn(dir)
    const decided = await old.add(
      { terminalHandle: 'term_old_lead' },
      { ticket: 'orca-7', decision: 'Split into 3 PRs', why: '~900 lines', evidence: 'PR #41' }
    )
    const pending = await old.add(
      { terminalHandle: 'term_old_lead' },
      { ticket: 'ORCA-7', decision: 'Drop the legacy flag after lab.130', followUp: true }
    )

    // Why a new store: the old lead's chat and the runtime's memory are both gone.
    const list = await trailIn(dir, 5).list({ terminalHandle: 'term_new_lead' })

    expect(list.decisions).toEqual([
      {
        id: decided.decision.id,
        at: '2026-11-25T10:00:00.000Z',
        ticket: 'ORCA-7',
        decision: 'Split into 3 PRs',
        why: '~900 lines',
        evidence: 'PR #41',
        followUp: null
      }
    ])
    expect(list.followUps.map((one) => [one.id, one.followUp])).toEqual([
      [pending.decision.id, { doneAt: null }]
    ])
    expect(decided.decision.id).toMatch(/^dec_[0-9a-f]{12}$/)
  })

  it('closes a follow-up once for every lead, and refuses an unknown id or a plain decision', async () => {
    const dir = tempDir()
    const lead = trailIn(dir)
    const plain = await lead.add({ terminalHandle: 'term_lead' }, { decision: 'Use zod' })
    const { decision } = await lead.add(
      { terminalHandle: 'term_lead' },
      { decision: 'Retry the queue run', followUp: true }
    )

    const done = await trailIn(dir, 9).done({ terminalHandle: 'term_new_lead', id: decision.id })
    expect(done).toMatchObject({
      repeated: false,
      decision: { followUp: { doneAt: '2026-11-25T10:00:09.000Z' } }
    })
    await expect(
      lead.done({ terminalHandle: 'term_lead', id: decision.id })
    ).resolves.toMatchObject({
      repeated: true
    })
    await expect(lead.done({ id: plain.decision.id })).rejects.toThrow('not a follow-up')
    await expect(lead.done({ id: 'dec_000000000000' })).rejects.toThrow('No decision')

    const list = await lead.list({})
    expect(list.followUps).toEqual([])
    expect(list.decisions.map((one) => one.id)).toEqual([decision.id, plain.decision.id])
  })

  it("lets a member read its lead's trail but never write it", async () => {
    const trail = trailIn(tempDir())
    await trail.add({ terminalHandle: 'term_lead' }, { ticket: 'ORCA-7', decision: 'Ship it' })

    await expect(
      trail.add({ terminalHandle: 'term_member' }, { decision: 'Mine' })
    ).rejects.toThrow('Only the lead')
    await expect(trail.done({ terminalHandle: 'term_member', id: 'dec_x' })).rejects.toThrow(
      'Only the lead'
    )
    expect((await trail.list({ terminalHandle: 'term_member' })).decisions).toHaveLength(1)
  })

  it("keeps the trail beside the team XP in the project's one file, neither costing the other", async () => {
    const dir = tempDir()
    const store = new GameHistoryStore(() => dir)
    const xp = new GameTeamXpLedger({ store, projectOf, now: () => 1 })
    const trail = new GameDecisionTrail({ store, projectOf })

    await trail.add({}, { decision: 'Keep one file per project' })
    await xp.award({}, [{ id: 'ci:1', kind: 'ci-green', xp: 10, label: 'PR #1' }])

    expect((await trail.list({})).decisions).toHaveLength(1)
    expect((await xp.read({})).total).toBeGreaterThan(0)
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    const kept = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
    expect(kept.decisions).toHaveLength(1)
    expect(kept.teamXp).toBeDefined()
  })
})
