// Runs under `claude plugin test`: under the conversation, one live line says who works, how long, and on what.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const MEMBER_STATE = {
  config: {},
  sources: {},
  warnings: [],
  role: 'member',
  worktree: { id: 'wt-1', path: '/w', branch: 'b', displayName: 'Castillo · ORCA-1047 Game panes' },
  agents: [],
  review: null,
  workItem: null
}

const ABOVE_PROMPT = {
  plugin: 'orca-game',
  surface: 'terminal',
  component: 'AbovePrompt',
  viewport: { columns: 124, rows: 40, isFullscreen: true },
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 8,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 7 },
    view: {}
  }
} as const

const TURN_END = { reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as const

const start = async ($: Engine, on: On, env: Record<string, string> = {}) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en', ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on(
    'ui.render',
    (_$, e) => ({ type: 'Text', props: {}, children: [`native ${e.component}`] }) as never
  )
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {}, text: '' }) as never)
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify({ id: 'x', ok: true, result: MEMBER_STATE }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const runTool = ($: Engine, tool: string, input: object) => $.tool.call({ tool, ...input } as never)

describe('the live line', () => {
  test('shows nothing before a turn has run', async ($, on) => {
    await start($, on)
    const ui = await $.ui.mount(ABOVE_PROMPT)
    expect(await ui.find({ type: 'Text', text: 'Castillo' })).toBeUndefined()
    await ui.unmount()
  })

  test('while working: glyph, name, phase, timer and the current step', async ($, on) => {
    const clock = await start($, on)
    await $.turn.start({ text: 'Review #923', turnId: 't1' })
    await runTool($, 'Bash', { command: 'gh pr view 923', description: 'gh pr view 923' })
    await clock.advance(4_000)
    const ui = await $.ui.mount(ABOVE_PROMPT)
    expect((await ui.find({ type: 'Text', text: 'Castillo' }))?.props.bold).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^[·✢✳✶✻✽]$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 0:04$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / · gh pr view 923$/ })).toBeDefined()
    await clock.advance(2_000)
    expect(await ui.find({ type: 'Text', text: / 0:06$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a turn ending in a question waits on the person, in red', async ($, on) => {
    const clock = await start($, on)
    await $.turn.start({ text: 'Review #923', turnId: 't1' })
    await clock.advance(3_000)
    await $.turn.complete({ ...TURN_END, answer: 'All green.\n\nShould I merge #923?' })
    const ui = await $.ui.mount({
      ...ABOVE_PROMPT,
      props: { ...ABOVE_PROMPT.props, isWorking: false }
    })
    expect((await ui.find({ type: 'Text', text: '◆' }))?.props.color).toBe('red')
    expect(await ui.find({ type: 'Text', text: / Waiting on you/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / · Should I merge #923\?$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a finished turn is done, in green, with its length', async ($, on) => {
    const clock = await start($, on)
    await $.turn.start({ text: 'Review #923', turnId: 't1' })
    await clock.advance(9_000)
    await $.turn.complete({ ...TURN_END, answer: 'Merged #923.' })
    await clock.advance(60_000)
    const ui = await $.ui.mount({
      ...ABOVE_PROMPT,
      props: { ...ABOVE_PROMPT.props, isWorking: false }
    })
    expect((await ui.find({ type: 'Text', text: '✓' }))?.props.color).toBe('green')
    expect(await ui.find({ type: 'Text', text: / Done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 0:09$/ })).toBeDefined()
    await ui.unmount()
  })

  test('an interrupted turn claims neither done nor working', async ($, on) => {
    const clock = await start($, on)
    await $.turn.start({ text: 'Review #923', turnId: 't1' })
    await clock.advance(2_000)
    await $.turn.complete({ ...TURN_END, reason: 'aborted', isAborted: true, answer: '' })
    const ui = await $.ui.mount({
      ...ABOVE_PROMPT,
      props: { ...ABOVE_PROMPT.props, isWorking: false }
    })
    expect(await ui.find({ type: 'Text', text: 'Castillo' })).toBeUndefined()
    await ui.unmount()
  })

  test("it stands in for Claude Code's spinner", async ($, on) => {
    await start($, on)
    const spinner = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      component: 'Spinner',
      viewport: ABOVE_PROMPT.viewport,
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'responding' }
    } as never)
    expect(await spinner.find({ type: 'Text', text: /native Spinner/ })).toBeUndefined()
    expect(await spinner.find({ type: 'Raster' })).toBeUndefined()
    await spinner.unmount()
  })

  test('mode off keeps the spinner and draws no live line', async ($, on) => {
    const clock = await start($, on, { ORCA_GAME_MODE: 'off' })
    await $.turn.start({ text: 'Review #923', turnId: 't1' })
    await clock.advance(1_000)
    const ui = await $.ui.mount(ABOVE_PROMPT)
    expect(await ui.find({ type: 'Text', text: 'Castillo' })).toBeUndefined()
    await ui.unmount()
    const spinner = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      component: 'Spinner',
      viewport: ABOVE_PROMPT.viewport,
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'responding' }
    } as never)
    expect(await spinner.find({ type: 'Text', text: /native Spinner/ })).toBeDefined()
    await spinner.unmount()
  })
})
