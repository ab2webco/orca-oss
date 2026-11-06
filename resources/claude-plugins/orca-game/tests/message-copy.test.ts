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

  test('a later block of the same reply draws its body alone', async ($, on) => {
    await start($, on)
    const row = await reply($, 'Second block.', false)
    expect(textOf(await row.drawn())).toBe('native AssistantMessage')
    await row.unmount()
  })

  test('a question to the person has its own heading, in the needs-you colour', async ($, on) => {
    await start($, on, { ORCA_GAME_LOCALE: 'es' })
    const row = await reply($, 'Tests en verde.\n\n¿Abro el PR?', false)
    const heading = await row.find({ type: 'Text', text: /^Escudero · te pregunta$/ })
    expect(heading?.props.color).toBe('red')
    expect(framingOf(await row.drawn())).toEqual([])
    await row.unmount()
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

  test('a collapsed tool group draws one dim summary line', async ($, on) => {
    await start($, on)
    const row = await mount($, 'ToolGroup', {
      calls: [call('Read', { file_path: '/w/a.ts' }), call('Read', { file_path: '/w/b.ts' })],
      isActive: false,
      isExpanded: false
    })
    const line = await row.find({ type: 'Text', text: /^▸ Read 2 files$/ })
    expect(line?.props.dimColor).toBe(true)
    await row.unmount()
  })

  test('a standalone tool row draws one dim line of what it did', async ($, on) => {
    await start($, on)
    const row = await mount($, 'ToolUse', {
      tool_use_id: 't1',
      ...call('Edit', { file_path: '/w/src/quest.tsx' })
    })
    const line = await row.find({ type: 'Text', text: /^▸ .*quest\.tsx$/ })
    expect(line?.props.dimColor).toBe(true)
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
