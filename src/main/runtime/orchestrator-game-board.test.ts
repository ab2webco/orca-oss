import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameBoard, type GameBoardProject } from './orchestrator-game-board'
import { GameHistoryStore } from './orchestrator-game-history-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const LEAD: GameBoardProject = { key: 'repo:r1', isMember: false, memberTicket: null }
const MEMBER: GameBoardProject = { key: 'repo:r1', isMember: true, memberTicket: 'CIN-7' }

function board(projectOf: (caller: { terminalHandle?: string }) => GameBoardProject) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-board-'))
  dirs.push(dir)
  let tick = 0
  return new GameBoard({
    store: new GameHistoryStore(() => dir),
    projectOf: async (caller) => projectOf(caller),
    now: () => new Date(Date.UTC(2026, 9, 16, 10, 0, tick++))
  })
}

describe('GameBoard events', () => {
  it('posts the lead its own events and a member under its own ticket', async () => {
    const game = board((caller) => (caller.terminalHandle === 'term_member' ? MEMBER : LEAD))

    await game.postEvent({ terminalHandle: 'term_lead', kind: 'claimed', ticket: 'cin-7' })
    await game.postEvent({
      terminalHandle: 'term_member',
      kind: 'pr_opened',
      ticket: 'CIN-99',
      text: 'PR #41'
    })

    const { events } = await game.events({ terminalHandle: 'term_lead' })
    expect(events.map((one) => [one.kind, one.ticket, one.by, one.text])).toEqual([
      ['pr_opened', 'CIN-7', 'CIN-7', 'PR #41'],
      ['claimed', 'CIN-7', 'lead', null]
    ])
  })

  it('keeps an observed event once by its key and filters by ticket', async () => {
    const game = board(() => LEAD)
    const merged = { terminalHandle: 'term_lead', kind: 'merged' as const, ticket: 'CIN-1' }

    await expect(game.postEvent({ ...merged, key: 'merged CIN-1 #4' })).resolves.toMatchObject({
      posted: true
    })
    await expect(game.postEvent({ ...merged, key: 'merged CIN-1 #4' })).resolves.toMatchObject({
      posted: false
    })
    await game.postEvent({ terminalHandle: 'term_lead', kind: 'failed', ticket: 'CIN-2' })

    expect((await game.events({ ticket: 'cin-1' })).events).toHaveLength(1)
    expect((await game.events({})).events).toHaveLength(2)
  })
})
