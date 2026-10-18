import { describe, expect, it } from 'vitest'
import { GameLeads } from './orchestrator-game-leads'
import type { GameBoardProject } from './orchestrator-game-board'

const LEAD: GameBoardProject = {
  key: 'repo:a',
  isMember: false,
  memberTicket: null,
  lead: { handle: 'term_a', paneKey: null }
}

function leads(project: GameBoardProject, live: string[] = ['term_a']) {
  return new GameLeads({
    projectOf: async () => project,
    isLive: (handle) => live.includes(handle),
    now: () => new Date(Date.UTC(2026, 9, 17, 10))
  })
}

describe('GameLeads', () => {
  it('registers the calling lead for its project and lists it while its terminal lives', async () => {
    const game = leads(LEAD)

    await expect(
      game.register({ terminalHandle: 'term_a', project: 'cineco', label: 'Ana' })
    ).resolves.toEqual({ registered: true })

    expect(game.list()).toEqual({
      leads: [
        { project: 'cineco', label: 'Ana', handle: 'term_a', since: '2026-10-17T10:00:00.000Z' }
      ]
    })
  })

  it('never registers a member or a caller without a terminal', async () => {
    const member = leads({ ...LEAD, isMember: true, memberTicket: 'CIN-1' })
    const nobody = leads({ ...LEAD, lead: null })

    await expect(member.register({ project: 'cineco', label: '' })).resolves.toEqual({
      registered: false
    })
    await expect(nobody.register({ project: 'cineco', label: '' })).resolves.toEqual({
      registered: false
    })
    expect(member.list().leads).toEqual([])
    expect(nobody.list().leads).toEqual([])
  })

  it('drops a lead once its terminal is gone', async () => {
    const live = ['term_a']
    const game = leads(LEAD, live)
    await game.register({ project: 'cineco', label: 'Ana' })

    live.length = 0

    expect(game.list().leads).toEqual([])
  })

  it('gives the inbox the labels of the live leads', async () => {
    const game = leads(LEAD)
    await game.register({ project: 'cineco', label: '' })

    expect(game.labels()).toEqual({ term_a: 'cineco' })
  })
})
