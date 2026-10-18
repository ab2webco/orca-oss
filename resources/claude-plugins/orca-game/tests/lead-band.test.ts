// Runs under `claude plugin test`: the lead's own band rests only once no member works and it is idle.
import { describe, expect, test } from 'claude-code/testing'

import type { GameAgent, GameState } from '../types'
import { syncHdTeam } from '../hooks/hd-team'
import { resetQuest } from '../hooks/quest-runtime'
import { shownResting } from '../hooks/quest-state'
import { questToolCall } from '../hooks/quest-turns'

const agent = (patch: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'a',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  ...patch
})

const state = (agents: GameAgent[], patch: Partial<GameState> = {}): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: null,
  agents,
  review: null,
  workItem: null,
  role: 'lead',
  ...patch
})

const LEAD_DONE = agent({ paneKey: 'lead', state: 'done', isLeader: true })
const LEAD_WORKING = agent({ paneKey: 'lead', isLeader: true })
const BUILDER = agent({ paneKey: 'm1', toolName: 'Edit' })
const DONE_MEMBER = agent({ paneKey: 'm2', state: 'done' })
const STATUS_SET = { command: 'orca plane status set ORCA-1 --to "In Progress"' }

describe("the lead's own band", () => {
  test('moving a ticket does not put an orchestrating lead to sleep', () => {
    resetQuest()
    syncHdTeam(state([LEAD_DONE, BUILDER]), true)
    questToolCall('Bash', STATUS_SET, undefined)
    expect(shownResting()).toBe(false)
  })

  test('a merge does not put a lead that is still working to sleep', () => {
    resetQuest()
    syncHdTeam(state([LEAD_WORKING]), true)
    questToolCall('Bash', { command: 'gh pr merge 12 --auto --squash' }, undefined)
    expect(shownResting()).toBe(false)
  })

  test('a lead idle with nobody at work sleeps', () => {
    resetQuest()
    syncHdTeam(state([LEAD_DONE, DONE_MEMBER]), true)
    expect(shownResting()).toBe(true)
  })

  test('a lead the last refresh saw asleep wakes on its own next tool call', () => {
    resetQuest()
    syncHdTeam(state([LEAD_DONE]), true)
    expect(shownResting()).toBe(true)
    questToolCall('Read', { file_path: 'a.ts' }, undefined)
    expect(shownResting()).toBe(false)
  })

  test("control: a member's pane still rests once it moves its ticket", () => {
    resetQuest()
    syncHdTeam(state([LEAD_DONE, BUILDER], { role: 'member' }), true)
    questToolCall('Bash', STATUS_SET, undefined)
    expect(shownResting()).toBe(true)
  })

  test('control: a lead pane before its first refresh keeps the finishing latch', () => {
    resetQuest()
    questToolCall('Bash', STATUS_SET, undefined)
    expect(shownResting()).toBe(true)
  })
})
