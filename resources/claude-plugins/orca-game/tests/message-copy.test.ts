// Runs under `claude plugin test`: a terminal selection copies every cell of a row, so what the
// mod draws around a message must hold no border, no padding and no box or rule characters.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const VIEWPORT = { columns: 120, rows: 40, isFullscreen: true } as const
const ORCA_CLI = '/opt/orca/bin/orca'
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
const LEAD_STATE = {
  ...MEMBER_STATE,
  role: 'lead',
  worktree: { id: 'wt-0', path: '/w', branch: 'main', displayName: 'orca-oss' },
  agents: [
    {
      paneKey: 'p0',
      displayName: 'Castillo · ORCA-1092 Audit',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    }
  ],
  lead: { autostart: false, cap: 4, label: 'Boss' }
}
// Box drawing, block elements and the half-blocks a rule or frame is drawn with.
const BOX_CHARACTERS = /[─-▟]/
// Why marginTop passes: an empty row above copies as nothing, while side spacing copies as spaces.
const SPACING = /^(border|padding|margin(?!Top$))/

type Element = { type?: string; props?: Record<string, unknown>; children?: unknown }

const elementsOf = (one: unknown): Element[] => {
  if (typeof one !== 'object' || one === null) {
    return []
  }
  const element = one as Element
  const children = Array.isArray(element.children) ? element.children : []
  return [element, ...children.flatMap(elementsOf)]
}

const textOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  const children = typeof one === 'object' && one !== null ? (one as Element).children : undefined
  return Array.isArray(children) ? children.map(textOf).join('') : ''
}

// What the mod added around the body: any frame, padding or margin prop, and any rule glyph.
const framingOf = (tree: RenderElement): string[] =>
  elementsOf(tree).flatMap((element) => [
    ...Object.entries(element.props ?? {})
      .filter(([key, value]) => SPACING.test(key) && value !== undefined && value !== 0)
      .map(([key]) => `${element.type}.${key}`),
    ...(element.type === 'Text' && BOX_CHARACTERS.test(textOf(element)) ? [textOf(element)] : [])
  ])

const start = async ($: Engine, on: On, env: Record<string, string> = {}, state?: object) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ORCA_GAME_LOCALE: 'en', ...env })
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
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('process.run', () => ({
    value: {
      exitCode: state === undefined ? 1 : 0,
      stdout: state === undefined ? '' : JSON.stringify({ id: 'x', ok: true, result: state }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const mount = ($: Engine, component: string, props: object) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component,
    viewport: VIEWPORT,
    props
  } as never)

const reply = ($: Engine, text: string, isFirstOfReply = true) =>
  mount($, 'AssistantMessage', { text, isFirstOfReply })

const replyAt = ($: Engine, columns: number, text: string) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AssistantMessage',
    viewport: { ...VIEWPORT, columns },
    props: { text, isFirstOfReply: true }
  } as never)

const call = (tool: string, input: object, extra: object = {}) => ({
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...extra
})

describe('message copy', () => {
  test('a reply draws a heading row and its body, with nothing framing either', async ($, on) => {
    await start($, on)
    const row = await reply($, 'The build is green.')
    const tree = await row.drawn()
    expect(framingOf(tree)).toEqual([])
    expect(await row.find({ type: 'Text', text: /^Squire · working$/ })).toBeDefined()
    expect(await row.find({ type: 'Text', text: /^native AssistantMessage$/ })).toBeDefined()
    await row.unmount()
  })

  test("a member's reply is headed by its character", async ($, on) => {
    await start($, on, { ORCA_GAME_ROLE: 'member' }, MEMBER_STATE)
    const row = await reply($, 'The build is green.')
    expect(await row.find({ type: 'Text', text: /^Castillo · working$/ })).toBeDefined()
    await row.unmount()
  })

  test('the heading runs a rule of plain spaces to the time into the turn', async ($, on) => {
    const clock = await start($, on)
    await $.turn.start({ text: 'Fix the build', turnId: 't1' })
    await clock.advance(6_000)
    const row = await reply($, 'The build is green.')
    // Why these values: V30's --head, its rule at .28 over --term, and --term-dim.
    expect((await row.find({ type: 'Text', text: /^Squire · working$/ }))?.props).toMatchObject({
      bold: true,
      color: '#e6e8ec'
    })
    const rule = await row.find({ type: 'Text', text: /^ {3,}$/ })
    expect(rule?.props).toMatchObject({ strikethrough: true, color: '#5a5d64' })
    expect((await row.find({ type: 'Text', text: /^ 0:06$/ }))?.props.color).toBe('#8b93a1')
    expect(framingOf(await row.drawn())).toEqual([])
    await row.unmount()
  })

  test('a heading keeps the time it was first drawn at', async ($, on) => {
    const clock = await start($, on)
    await $.turn.start({ text: 'Fix the build', turnId: 't1' })
    await clock.advance(6_000)
    const row = await reply($, 'The build is green.')
    await clock.advance(120_000)
    await row.redraw({ text: 'The build is green.', isFirstOfReply: true } as never)
    expect(await row.find({ type: 'Text', text: /^ 0:06$/ })).toBeDefined()
    await row.unmount()
  })

  test('a reply drawn with no turn seen, as on a resume, has no time', async ($, on) => {
    await start($, on)
    const row = await reply($, 'The build is green.')
    expect(await row.find({ type: 'Text', text: /\d:\d\d|min/ })).toBeUndefined()
    await row.unmount()
  })

  test("the lead's reply is headed by its own character, as its Team card names it", async ($, on) => {
    await start($, on, {}, LEAD_STATE)
    const row = await reply($, 'Queued #923.')
    expect(await row.find({ type: 'Text', text: /^Castillo · working$/ })).toBeDefined()
    await row.unmount()
  })

  test('a later block of the same reply draws its body alone', async ($, on) => {
    await start($, on)
    const row = await reply($, 'Second block.', false)
    expect(textOf(await row.drawn())).toBe('native AssistantMessage')
    await row.unmount()
  })

  test("a question to the person has its own heading, in V30's wait pink", async ($, on) => {
    await start($, on, { ORCA_GAME_LOCALE: 'es' })
    const row = await reply($, 'Tests en verde.\n\n¿Abro el PR?', false)
    const heading = await row.find({ type: 'Text', text: /^Escudero · te pregunta$/ })
    expect(heading?.props.color).toBe('#ffb7b8')
    const rule = await row.find({ type: 'Text', text: /^ {3,}$/ })
    expect(rule?.props).toMatchObject({ color: '#614f55', strikethrough: true })
    expect(framingOf(await row.drawn())).toEqual([])
    await row.unmount()
  })

  // Why the panel's light tokens: V30 is dark only; --agent-question-text, --muted-foreground.
  test("in Orca's light look the heading takes the panel's light colours", async ($, on) => {
    const clock = await start($, on, {}, { ...MEMBER_STATE, appearance: 'light' })
    await $.turn.start({ text: 'Fix the build', turnId: 't1' })
    await clock.advance(6_000)
    const answer = await reply($, 'The build is green.')
    expect((await answer.find({ type: 'Text', text: /^Castillo · working$/ }))?.props.color).toBe(
      '#0a0a0a'
    )
    expect((await answer.find({ type: 'Text', text: /^ {3,}$/ }))?.props.color).toBe('#bababa')
    expect((await answer.find({ type: 'Text', text: /^ 0:06$/ }))?.props.color).toBe('#737373')
    await answer.unmount()
    const ask = await reply($, 'Green.\n\nShall I open the PR?', false)
    expect((await ask.find({ type: 'Text', text: /^Castillo · asks you$/ }))?.props.color).toBe(
      '#b60010'
    )
    expect((await ask.find({ type: 'Text', text: /^ {3,}$/ }))?.props.color).toBe('#ebb8bc')
    await ask.unmount()
  })

  test("the lead's heading takes the name its Team card shows, not its branch", async ($, on) => {
    const lead = {
      ...LEAD_STATE,
      leadName: 'Elaine',
      agents: [{ ...LEAD_STATE.agents[0], displayName: 'main' }]
    }
    await start($, on, {}, lead)
    const row = await reply($, 'Queued #923.')
    expect(await row.find({ type: 'Text', text: /^Elaine · working$/ })).toBeDefined()
    await row.unmount()
  })

  // Why: a pane a few columns wide wrapped the heading mid-word (live check 2, 390 px).
  test('a narrow pane drops the rule and time before it would wrap the heading', async ($, on) => {
    const clock = await start($, on)
    await $.turn.start({ text: 'Fix the build', turnId: 't1' })
    await clock.advance(6_000)
    const fits = await replyAt($, 22, 'The build is green.')
    expect(await fits.find({ type: 'Text', text: /^ {3,}$/ })).toBeUndefined()
    expect(await fits.find({ type: 'Text', text: /^ 0:06$/ })).toBeDefined()
    await fits.unmount()
    const narrow = await replyAt($, 10, 'Still green.')
    const heading = await narrow.find({ type: 'Text', text: /^Squire · working$/ })
    expect(heading?.props.wrap).toBe('truncate-end')
    expect(await narrow.find({ type: 'Text', text: /0:06/ })).toBeUndefined()
    await narrow.unmount()
  })

  test("the person's own message draws as Claude Code draws it", async ($, on) => {
    await start($, on)
    const row = await mount($, 'UserMessage', {
      text: 'Fix the build',
      origin: { kind: 'composer' },
      isExpanded: false
    })
    expect(textOf(await row.drawn())).toBe('native UserMessage')
    await row.unmount()
  })

  test("Orca's brief block draws with no frame", async ($, on) => {
    await start($, on)
    const row = await mount($, 'UserMessage', {
      text: 'Read your Orca Lab brief at .orca/briefs/ctx_ab12.md (task task_9f) and follow it.',
      origin: { kind: 'composer' },
      isExpanded: false
    })
    expect(await row.find({ type: 'Text', text: /Brief received/ })).toBeDefined()
    expect(framingOf(await row.drawn())).toEqual([])
    await row.unmount()
  })

  test('a collapsed tool group draws one summary line in V30 --term-dim', async ($, on) => {
    await start($, on)
    const row = await mount($, 'ToolGroup', {
      calls: [call('Read', { file_path: '/w/a.ts' }), call('Read', { file_path: '/w/b.ts' })],
      isActive: false,
      isExpanded: false
    })
    const line = await row.find({ type: 'Text', text: /^▸ Read 2 files$/ })
    expect(line?.props.color).toBe('#8b93a1')
    await row.unmount()
  })

  test('a standalone tool row draws one --term-dim line of what it did', async ($, on) => {
    await start($, on)
    const row = await mount($, 'ToolUse', {
      tool_use_id: 't1',
      ...call('Edit', { file_path: '/w/src/quest.tsx' })
    })
    const line = await row.find({ type: 'Text', text: /^▸ .*quest\.tsx$/ })
    expect(line?.props.color).toBe('#8b93a1')
    await row.unmount()
  })

  test('an errored tool row is left as Claude Code draws it', async ($, on) => {
    await start($, on)
    const row = await mount($, 'ToolUse', {
      tool_use_id: 't1',
      ...call('Bash', { command: 'false' }, { isErrored: true })
    })
    expect(textOf(await row.drawn())).toBe('native ToolUse')
    await row.unmount()
  })

  test('ctrl+o shows the group as Claude Code draws it', async ($, on) => {
    await start($, on)
    const row = await mount($, 'ToolGroup', {
      calls: [call('Read', { file_path: '/w/a.ts' })],
      isActive: false,
      isExpanded: true
    })
    expect(textOf(await row.drawn())).toBe('native ToolGroup')
    await row.unmount()
  })

  test('zen keeps tool rows quiet', async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'zen' })
    const row = await mount($, 'ToolGroup', {
      calls: [call('Read', { file_path: '/w/a.ts' })],
      isActive: false,
      isExpanded: false
    })
    expect(await row.find({ type: 'Text', text: /▸/ })).toBeUndefined()
    await row.unmount()
  })

  test('mode off draws every row as Claude Code does', async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'off' })
    const message = await reply($, 'The build is green.')
    expect(textOf(await message.drawn())).toBe('native AssistantMessage')
    await message.unmount()
    const group = await mount($, 'ToolGroup', {
      calls: [call('Read', { file_path: '/w/a.ts' })],
      isActive: false,
      isExpanded: false
    })
    expect(textOf(await group.drawn())).toBe('native ToolGroup')
    await group.unmount()
  })
})
