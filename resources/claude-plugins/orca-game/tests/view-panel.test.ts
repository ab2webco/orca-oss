// Runs under `claude plugin test`: the Panel's view selector, and the same view in the Panel, /orca-game:view and Orca's config.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE_ID } from '../hooks/fleet-pane'

const ORCA_CLI = '/opt/orca/bin/orca'
const POLL_MS = 30000

type World = {
  config: Record<string, unknown>
  extra: Record<string, unknown>
  calls: string[][]
  toasts: string[]
}

const worldOf = (
  extra: Record<string, unknown> = { viewScopes: ['project', 'global'], suggestedView: 'flat' }
): World => ({
  config: { mode: 'zen', render: 'classic' },
  extra,
  calls: [],
  toasts: []
})

const stateOf = (world: World) => ({
  config: world.config,
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    {
      paneKey: 'tab-1:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'idle',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  links: [],
  extensions: { scenes: [] },
  ...world.extra
})

const start = async ($: Engine, on: On, world: World) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ORCA_GAME_LOCALE: 'en' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.toast', ($s, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', ($s, e) => {
    const [, group, verb, view] = e.argv
    if (group === 'game' && verb === 'view') {
      world.calls.push([...e.argv])
      world.config =
        view === '2d-hd' ? { mode: 'on', render: 'hd' } : { ...world.config, mode: view }
    }
    const isState = group === 'game' && verb === 'state'
    return {
      value: {
        exitCode: isState || verb === 'view' ? 0 : 1,
        stdout: isState ? JSON.stringify(stateOf(world)) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.advance(POLL_MS)
  return clock
}

const pane = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    viewport: { columns: columns + 4, rows: 60, isFullscreen: true },
    props: {
      title: 'Fleet',
      isFocused: true,
      bodyColumns: columns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 50 },
      view: {}
    }
  })

type Mounted = Awaited<ReturnType<typeof pane>>

const textOf = async (ui: Mounted, key: string): Promise<string> =>
  (await ui.find({ type: 'Button', key }))?.text ?? ''

const nowOf = (list: string) => /^ {2}● (.+?)\s{2,}/m.exec(list)?.[1]

const listed = async ($: Engine) =>
  nowOf((await $.command.run({ command: 'orca-game:view', args: '' } as never)).text ?? '')

describe('the view selector in the Panel', () => {
  test('marks the current view and flags the suggested one, with every view and its cost', async ($, on) => {
    await start($, on, worldOf())
    const ui = await pane($, 130)
    expect(await textOf(ui, 'view')).toContain('◐ View: Zen')
    expect(await ui.find({ type: 'Button', key: 'view-pick-zen' })).toBeUndefined()
    await ui.press({ key: 'view' })
    expect(await textOf(ui, 'view-pick-off')).toContain('○ Off · light')
    expect(await textOf(ui, 'view-pick-flat')).toContain('○ Flat · light ★')
    expect(await textOf(ui, 'view-pick-zen')).toContain('● Zen · medium')
    expect(await textOf(ui, 'view-pick-2d-classic')).toContain('○ 2D classic · medium')
    expect(await textOf(ui, 'view-pick-2d-hd')).toContain('○ 2D hd · heavy')
    expect(await textOf(ui, 'view-scope-pane')).toContain('● this pane')
    expect(await textOf(ui, 'view-scope-project')).toContain('○ this project')
    expect(await textOf(ui, 'view-scope-global')).toContain('○ every project')
    await ui.unmount()
  })

  test('stores the pick for the chosen scope, then closes and names it', async ($, on) => {
    const world = worldOf()
    await start($, on, world)
    const ui = await pane($, 130)
    await ui.press({ key: 'view' })
    await ui.press({ key: 'view-scope-project' })
    expect(await textOf(ui, 'view-scope-project')).toContain('● this project')
    await ui.press({ key: 'view-pick-2d-hd' })
    expect(world.calls).toEqual([
      [ORCA_CLI, 'game', 'view', '2d-hd', '--scope', 'project', '--json']
    ])
    expect(world.toasts).toContain('View: 2D hd, saved for this project on this machine.')
    expect(await ui.find({ type: 'Button', key: 'view-pick-zen' })).toBeUndefined()
    expect(await textOf(ui, 'view')).toContain('◐ View: 2D hd')
    await ui.unmount()
  })

  test('offers this pane only, and says why, on an Orca that cannot store a view', async ($, on) => {
    const world = worldOf({})
    await start($, on, world)
    const ui = await pane($, 130)
    await ui.press({ key: 'view' })
    expect(await ui.find({ type: 'Button', key: 'view-scope-project' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text' })).map((one) => one.text)).toContain(
      'This Orca can change this pane only.'
    )
    await ui.press({ key: 'view-pick-flat' })
    expect(world.calls).toEqual([])
    expect(world.toasts).toContain('View: Flat, this pane only.')
    await ui.unmount()
  })

  test('fits a phone: the selector is chips no wider than the pane', async ($, on) => {
    await start($, on, worldOf())
    for (const columns of [40, 60]) {
      const ui = await pane($, columns)
      await ui.press({ key: 'view' })
      for (const group of ['view-scopes', 'view-picks']) {
        const box = await ui.find({ type: 'Box', key: group })
        expect(box, `${group} at ${columns}`).toBeDefined()
      }
      for (const chip of await ui.findAll({ type: 'Button' })) {
        for (const line of (chip.text ?? '').split('\n')) {
          expect([...line].length, `${String(chip.key)} at ${columns}`).toBeLessThanOrEqual(columns)
        }
      }
      await ui.press({ key: 'view' })
      await ui.unmount()
    }
  })
})

// Why one test: the ticket asks that a change in any one place shows in the other two within one refresh.
describe('one view in the Panel, /orca-game:view and Orca’s config', () => {
  test('a change in any place shows in the other two within one refresh', async ($, on) => {
    const world = worldOf()
    const clock = await start($, on, world)
    const ui = await pane($, 130)

    // Settings (Orca's config) → the Panel and the slash command, after one poll.
    world.config = { mode: 'on', render: 'classic' }
    await clock.advance(POLL_MS)
    expect(await textOf(ui, 'view')).toContain('View: 2D classic')
    expect(await listed($)).toBe('2D classic')

    // The slash command → the Panel at once, and Orca's config for a stored scope.
    await $.command.run({ command: 'orca-game:view', args: 'flat global' } as never)
    expect(await textOf(ui, 'view')).toContain('View: Flat')
    expect(world.config.mode).toBe('flat')

    // The Panel → the slash command at once, and Orca's config.
    await ui.press({ key: 'view' })
    await ui.press({ key: 'view-scope-global' })
    await ui.press({ key: 'view-pick-zen' })
    expect(await listed($)).toBe('Zen')
    expect(world.config.mode).toBe('zen')
    await clock.advance(POLL_MS)
    expect(await textOf(ui, 'view')).toContain('View: Zen')
    await ui.unmount()
  })
})
