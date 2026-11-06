// Runs under `claude plugin test`: no render of the mod feeds its own redraw (ORCA-989).
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { register } from '../hooks/register'

const ORCA_CLI = '/opt/orca/bin/orca'
const BURST = 200
// Why a constant: a render that invalidates or writes state once per draw adds BURST, never a few.
const FEEDBACK_MAX = 4
const COLUMNS = [40, 61, 80, 120, 160] as const
// Why: a BURST takes 3.7-4.5 s on the Windows runner, against the kit's 5 s default.
const BURST_TIMEOUT_MS = 30_000

type Target = { component: string; requestId?: string }
type Role = 'lead' | 'member'

// Every component any hooks/*.tsx draws, read from the mod's own registration so a new one is covered.
const targetsOf = (): Target[] => {
  const targets: Target[] = []
  const recording = ((event: string, filter: unknown) => {
    if (event === 'ui.render' && typeof filter === 'object' && filter !== null) {
      targets.push(filter as Target)
    }
  }) as unknown as On
  register(recording, {})
  return targets
}

const agent = (displayName: string, state: string, isLeader = false) => ({
  paneKey: `tab-1:${displayName}`,
  displayName,
  agentType: 'claude',
  state,
  toolName: state === 'working' ? 'Edit' : null,
  isLeader
})

const stateOf = (role: Role) => ({
  config: { mode: 'on', render: 'hd' },
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [agent('lead', 'working', true), agent('Daisy', 'working'), agent('Moss', 'waiting')],
  review: null,
  workItem: null,
  links: [],
  extensions: { scenes: [] },
  role
})

// Why i: each update hands the component different props, as a live session does.
const propsOf = (component: string, i: number): Record<string, unknown> => {
  const columns = COLUMNS[i % COLUMNS.length] ?? 80
  const scroll = { offset: 0, bodyRows: 4 + (i % 6) }
  const call = {
    tool: 'Edit',
    input: { i },
    isRunning: i % 2 === 0,
    isErrored: false,
    isInterrupted: false
  }
  switch (component) {
    case 'AbovePrompt':
      return {
        hasSurvey: false,
        isWorking: i % 2 === 0,
        maxRows: 3 + (i % 7),
        bodyColumns: columns,
        scroll,
        view: {}
      }
    case 'Pane':
      return {
        title: 'Fleet',
        isFocused: i % 3 === 0,
        bodyColumns: columns,
        placement: i % 2 === 0 ? 'dock' : 'inline',
        scroll,
        view: {}
      }
    case 'Spinner':
      return {
        word: `Working ${i}`,
        message: null,
        suffix: '',
        mode: i % 2 === 0 ? 'thinking' : 'tool-use'
      }
    case 'ToolUse':
      return { tool_use_id: `t${i}`, ...call }
    case 'ToolResult':
      return { tool_use_id: `t${i}`, tool: 'Edit', output: `done ${i}`, isErrored: false }
    case 'ToolGroup':
      return { calls: [call], isActive: i % 2 === 0, isExpanded: false }
    case 'TurnDuration':
      return { word: 'Cooked', durationMs: 1000 + i }
    case 'AssistantMessage':
      return { text: `Step ${i} done.`, isFirstOfReply: i % 2 === 0 }
    case 'UserMessage':
      // Why the brief: the mod draws only Orca's brief line; any other prompt is Claude Code's own.
      return {
        text: `Read your Orca Lab brief at .orca/briefs/ctx_${i}.md (task t${i}) and follow it.`,
        origin: { kind: 'composer' },
        isExpanded: false
      }
    default:
      throw new Error(`render-loop.test.ts has no props for ${component}: add a case`)
  }
}

type Counts = { renders: number; feedback: number }

const start = async ($: Engine, on: On, role: Role, counts: Counts) => {
  const clock = mock.clock(on)
  mock.env(on, {
    ORCA_GAME_CLI: ORCA_CLI,
    ORCA_GAME_ROLE: role,
    ORCA_GAME_LOCALE: 'en',
    ORCA_GAME_MODE: 'on'
  })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => {
    counts.feedback += 1
    return { value: undefined }
  })
  on('state.set', { plugin: 'orca-game' }, ($s, e, next) => {
    counts.feedback += 1
    return next(e)
  })
  on('ui.invalidate', ($s, e, next) => {
    counts.feedback += 1
    return next(e)
  })
  on('ui.render', () => {
    counts.renders += 1
    return { type: 'Text', props: {}, children: [] } as never
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', ($s, e) => {
    const isState = e.argv.slice(1).join(' ') === 'game state --json'
    return {
      value: {
        exitCode: 0,
        stdout: isState ? JSON.stringify(stateOf(role)) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

describe('render loops', () => {
  // Why: the team, its scene and the arcade draw in Orca's Team panel (ORCA-1055).
  test('the mod draws the line above the prompt and no scene or pane', () => {
    const drawn = targetsOf().map((one) => one.requestId ?? one.component)
    expect(drawn).toContain('AbovePrompt')
    for (const gone of ['Spinner', 'orca-game-fleet', 'orca-game-arcade']) {
      expect(drawn).not.toContain(gone)
    }
  })

  for (const role of ['lead', 'member'] as const) {
    for (const target of targetsOf()) {
      const name = target.requestId ?? target.component
      test(
        `${role}: ${BURST} updates to ${name} draw at most once each and feed no redraw`,
        { timeoutMs: BURST_TIMEOUT_MS },
        async ($, on) => {
          const counts: Counts = { renders: 0, feedback: 0 }
          const clock = await start($, on, role, counts)
          const ui = await $.ui.mount({
            plugin: 'orca-game',
            surface: 'terminal',
            viewport: { columns: 170, rows: 40, isFullscreen: true },
            ...target,
            props: propsOf(target.component, 0)
          } as never)
          await clock.settle()
          const before = { ...counts }
          for (let i = 1; i <= BURST; i += 1) {
            await ui.redraw(propsOf(target.component, i) as never)
          }
          await clock.settle()
          // Why the drawer: a render that throws falls back to the next hook's tree.
          expect(((await ui.drawn()) as { part?: { plugin?: string } }).part?.plugin).toBe(
            'orca-game'
          )
          expect(counts.renders - before.renders).toBeLessThanOrEqual(BURST)
          expect(counts.feedback - before.feedback).toBeLessThanOrEqual(FEEDBACK_MAX)
          await ui.unmount()
        }
      )
    }
  }
})
