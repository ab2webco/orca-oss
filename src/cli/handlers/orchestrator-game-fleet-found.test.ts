import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatFleet } from './orchestrator-game-fleet-format'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import {
  LEAD,
  fakeClient,
  freeing,
  member,
  merged,
  run,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'

// A session no `game launch` started, here a codex in a plain worktree whose PR merged.
const found = member({
  paneKey: 'tab-8:plain',
  displayName: 'orca-914',
  agentType: 'codex',
  state: 'done',
  terminalHandle: 'term_found',
  review: merged,
  worktree: { id: 'wt-914', branch: 'fabolivark/orca-914', displayName: 'orca-914' },
  found: true
})

describe('orca game fleet verbs on found sessions (ORCA-914)', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    process.env = { ...saved }
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('fleet text marks a found session and tells the lead to stop it by name, not sweep it', () => {
    const fleet = gameFleetReportOf({ lead: DEFAULT_GAME_LEAD, agents: [LEAD, found] as never })
    const row = formatFleet(fleet).split('\n')[2]

    expect(row).toContain('codex')
    expect(row).toContain('game stop ORCA-914')
    expect(row).not.toContain('sweep')
    expect(row).toMatch(/orca-914 \(found\)$/)
  })

  it('sweep --close and stop --all leave a found session running', async () => {
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, found] }))

    await run('game sweep', client, [['close', true]])
    await run('game stop', client, [['all', true]])

    expect(calls.filter(([method]) => method === 'terminal.close')).toEqual([])
  })

  it('stop by its name closes its terminal', async () => {
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, found] }))

    await run('game stop', client, [['tickets', 'orca-914']])

    expect(freeing(calls).filter(([method]) => method === 'terminal.close')).toEqual([
      ['terminal.close', { terminal: 'term_found' }]
    ])
  })
})
