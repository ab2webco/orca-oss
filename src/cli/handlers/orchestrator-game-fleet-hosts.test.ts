import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatFleet } from './orchestrator-game-fleet-format'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import {
  LEAD,
  fakeClient,
  member,
  methods,
  run,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'

describe('orca game fleet across paired hosts (ORCA-888)', () => {
  const saved = { ...process.env }
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('fleet text shows each host’s load, and wave stops at this Orca’s cap (ORCA-888)', async () => {
    const onImac = member({
      paneKey: 'i',
      displayName: 'CIN-9 on imac',
      remote: { host: 'imac', stateKnown: true }
    })
    const state = stateWith({
      agents: [LEAD, member({}), onImac],
      lead: { autostart: false, cap: 7, agent: 'claude' },
      hosts: [
        { host: 'local', cap: 1, status: 'ok' },
        { host: 'imac', id: 'env-imac', cap: 6, status: 'ok' }
      ]
    })
    const text = formatFleet(gameFleetReportOf(state as never))
    expect(text.split('\n')[1]).toBe('Hosts: local 1/1 · imac 1/6')

    const { client, calls } = fakeClient(state)
    await run('game wave', client, [['dry-run', true]])
    expect(methods(calls)).toEqual(['game.state'])
    expect(printed()).toEqual(
      expect.objectContaining({
        free: 0,
        launch: [],
        skipped: [
          { ticket: 'CIN-1', reason: 'already running' },
          { ticket: 'CIN-2', reason: 'cap' },
          { ticket: 'CIN-3', reason: 'cap' }
        ]
      })
    )
  })
})
