import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_PLAN_HANDLERS, formatGameStewardLog } from './orchestrator-game-plan'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { REPEATED_FLAG_SEPARATOR } from '../args'
import { gameKindEffortPlanOf } from '../../shared/orchestrator-game-effort-plan'

function fakeClient(answer: unknown) {
  const calls: [string, Record<string, unknown>][] = []
  const client = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push([method, params])
      if (answer instanceof Error) {
        throw answer
      }
      return { ok: true, result: answer }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, flags: [string, string][], json = false) =>
  ORCHESTRATOR_GAME_PLAN_HANDLERS['game plan']({ flags: new Map(flags), client, cwd: '/r', json })

let printed: string[]
beforeEach(() => {
  printed = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    printed.push(String(line))
  })
})
afterEach(() => vi.restoreAllMocks())

describe('orca game plan', () => {
  it("prints a ticket's plan when no phase is given", async () => {
    const { client, calls } = fakeClient({
      ticket: 'ORCA-7',
      known: true,
      plan: gameKindEffortPlanOf('audit')
    })
    await run(client, [['ticket', 'orca-7']])
    expect(calls).toEqual([['game.effortPlan', expect.objectContaining({ ticket: 'ORCA-7' })]])
    expect(calls[0]?.[1]).not.toHaveProperty('phases')
    expect(printed.join('')).toContain('ORCA-7 · plan: audit ticket default')
    expect(printed.join('')).toContain('map  Sonnet 5.5 · medium')
  })

  it('sends every --phase in order as the lead plan', async () => {
    const { client, calls } = fakeClient({ ticket: 'ORCA-7', known: true, plan: null })
    const phases = ['map:sonnet-5-5:medium:read', 'implement:opus-5-5:high:risky path'].join(
      REPEATED_FLAG_SEPARATOR
    )
    await run(client, [
      ['ticket', 'ORCA-7'],
      ['phase', phases]
    ])
    expect(calls[0]?.[1].phases).toEqual([
      { phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'read' },
      { phase: 'implement', model: 'claude-opus-5-5', effort: 'high', why: 'risky path' }
    ])
  })

  it('refuses a bad phase before calling Orca, and names a ticket nobody launched', async () => {
    const { client, calls } = fakeClient({ ticket: 'ORCA-8', known: false, plan: null })
    await expect(
      run(client, [
        ['ticket', 'ORCA-8'],
        ['phase', 'deploy:opus-5-5:high:x']
      ])
    ).rejects.toThrow('Unknown phase "deploy"')
    expect(calls).toEqual([])
    await expect(run(client, [])).rejects.toThrow('orca game plan <ticket>')

    await run(client, [['ticket', 'ORCA-8']])
    expect(printed.join('')).toContain('No member is saved for ORCA-8 in this project.')
  })

  it('says to update Orca when the runtime has no plans yet', async () => {
    const { client } = fakeClient(new RuntimeClientError('method_not_found', 'Unknown method'))
    await expect(run(client, [['ticket', 'ORCA-7']])).rejects.toThrow('Update or restart Orca Lab')
  })
})

describe('orca game steward-log (ORCA-1242)', () => {
  const runLog = (client: RuntimeClient, flags: [string, string][]) =>
    ORCHESTRATOR_GAME_PLAN_HANDLERS['game steward-log']({
      flags: new Map(flags),
      client,
      cwd: '/r',
      json: false
    })

  it("prints a ticket's decisions oldest first, marking one not applied", async () => {
    const entry = {
      at: 0,
      moment: 'edit',
      phase: 'implement',
      from: { model: 'claude-sonnet-5-5', effort: 'medium' },
      to: { model: 'claude-opus-5-5', effort: 'high' },
      source: 'plan',
      why: 'editing code',
      session: 's1'
    }
    const { client, calls } = fakeClient({
      ticket: 'ORCA-7',
      entries: [
        { ...entry, applied: true },
        { ...entry, at: 1000, applied: false }
      ]
    })
    await runLog(client, [['ticket', 'orca-7']])
    expect(calls).toEqual([['game.stewardLog', expect.objectContaining({ ticket: 'ORCA-7' })]])
    const lines = printed.join('\n').split('\n')
    expect(lines[0]).toBe(
      '1970-01-01T00:00:00.000Z edit implement claude-sonnet-5-5 medium → claude-opus-5-5 high · plan: editing code'
    )
    expect(lines[1]).toContain('high (not applied) · plan')
  })

  it('says so when nothing is logged, and an older Orca asks for an update', async () => {
    await runLog(fakeClient({ ticket: 'ORCA-7', entries: [] }).client, [['ticket', 'ORCA-7']])
    expect(printed.join('')).toContain('no decision for ORCA-7')
    const old = fakeClient(new RuntimeClientError('method_not_found', 'no'))
    await expect(runLog(old.client, [['ticket', 'ORCA-7']])).rejects.toThrow('steward logs')
    await expect(runLog(old.client, [])).rejects.toThrow('orca game steward-log <ticket>')
  })
})

// ORCA-1350: the log says how warm the member's cache was and what a switch would have cost.
describe('formatGameStewardLog', () => {
  const entry = {
    at: Date.UTC(2026, 10, 22, 12),
    moment: 'pr-ci',
    phase: 'pr-ci',
    from: { model: 'claude-opus-5-5', effort: 'high' },
    to: { model: 'claude-opus-5-5', effort: 'low' },
    applied: true,
    source: 'default',
    why: 'watching the PR and CI',
    session: 's1'
  }

  it('adds the cache state, its TTL and the break-even to a decision that read the cache', () => {
    const cache = {
      warm: true,
      known: true,
      ttl: '1h' as const,
      contextTokens: 120_000,
      why: 'warm-hold',
      extraUsd: 0.4712,
      breakEven: 38
    }
    expect(formatGameStewardLog({ ticket: 'ORCA-7', entries: [{ ...entry, cache }] })).toBe(
      '2026-11-22T12:00:00.000Z pr-ci pr-ci claude-opus-5-5 high → claude-opus-5-5 low · default: watching the PR and CI · cache warm 1h 120k: warm-hold, switch $0.47, N* 38'
    )
    expect(formatGameStewardLog({ ticket: 'ORCA-7', entries: [entry] })).not.toContain('cache')
  })

  it('says how many turns the phase it left took', () => {
    const left = { ...entry, phaseTurns: { phase: 'implement' as const, turns: 37 } }
    expect(formatGameStewardLog({ ticket: 'ORCA-7', entries: [left] })).toMatch(
      / · left implement after 37 turns$/
    )
  })
})
