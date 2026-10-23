// Runs under `claude plugin test`: Orca's one-line brief draws as a "brief received" block.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BRIEF = 'Read your Orca Lab brief at .orca/briefs/ctx_ab12.md (task task_9f) and follow it.'
const VIEWPORT = { columns: 120, rows: 40, isFullscreen: true } as const

type Drawn = { children?: unknown }
const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  const children = typeof one === 'object' && one !== null ? (one as Drawn).children : undefined
  return Array.isArray(children) ? children.map(shownOf).join('') : ''
}

const start = async ($: Engine, on: On, env: Record<string, string> = {}) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_ROLE: 'member', ORCA_GAME_LOCALE: 'en', ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [BRIEF] }) as never)
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
}

const userMessage = ($: Engine, text: string, isExpanded = false) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'UserMessage',
    viewport: VIEWPORT,
    props: { text, origin: { kind: 'composer' }, isExpanded }
  })

describe('brief block', () => {
  test("Orca's one-line brief draws as a brief received block naming the file", async ($, on) => {
    await start($, on)
    const row = await userMessage($, BRIEF)
    expect(await row.find({ type: 'Text', text: /Brief received/ })).toBeDefined()
    expect(await row.find({ type: 'Text', text: /\.orca\/briefs\/ctx_ab12\.md/ })).toBeDefined()
    await row.unmount()
  })

  test('the block speaks the launch language', async ($, on) => {
    await start($, on, { ORCA_GAME_LOCALE: 'es' })
    const row = await userMessage($, BRIEF)
    expect(await row.find({ type: 'Text', text: /Instrucciones recibidas/ })).toBeDefined()
    await row.unmount()
  })

  test('control: any other prompt keeps the teller block', async ($, on) => {
    await start($, on)
    const row = await userMessage($, 'Fix the build')
    expect(await row.find({ type: 'Text', text: /Brief received/ })).toBeUndefined()
    await row.unmount()
  })

  test('ctrl+o shows the line Orca typed, in place of the block', async ($, on) => {
    await start($, on)
    const row = await userMessage($, BRIEF, true)
    expect(await row.find({ type: 'Text', text: /Brief received/ })).toBeUndefined()
    expect(await row.find({ type: 'Text', text: /Read your Orca Lab brief at/ })).toBeDefined()
    await row.unmount()
  })

  test('mode off draws the brief as Claude does', async ($, on) => {
    await start($, on, { ORCA_GAME_MODE: 'off' })
    const row = await userMessage($, BRIEF)
    expect(await row.find({ type: 'Text', text: /Brief received/ })).toBeUndefined()
    expect(shownOf(await row.find({ type: 'Text' }))).toBe(BRIEF)
    await row.unmount()
  })
})
