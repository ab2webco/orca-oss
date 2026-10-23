// Runs under `claude plugin test`: /orca-game:view lists the views and switches this pane, this project or every project.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const ORCA_CLI = '/opt/orca/bin/orca'
const POLL_MS = 30000

type World = {
  config: Record<string, unknown>
  extra: Record<string, unknown>
  /** Exit code of `orca game view`; 1 is an older CLI that does not know it. */
  viewExit: number
  calls: string[][]
}

const worldOf = (patch: Partial<World> = {}): World => ({
  config: { mode: 'zen', render: 'classic' },
  extra: { viewScopes: ['project', 'global'], suggestedView: 'flat' },
  viewExit: 0,
  calls: [],
  ...patch
})

const stateOf = (world: World) => ({
  config: world.config,
  sources: world.extra.sources ?? {},
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

const engine = (on: On, world: World) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ORCA_GAME_LOCALE: 'en' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    const [, group, verb, view] = e.argv
    const isView = group === 'game' && verb === 'view'
    if (isView) {
      world.calls.push([...e.argv])
      if (world.viewExit === 0 && view === '2d-hd') {
        world.config = { ...world.config, mode: 'on', render: 'hd' }
      }
    }
    const isState = group === 'game' && verb === 'state'
    return {
      value: {
        exitCode: isView ? world.viewExit : isState ? 0 : 1,
        stdout: isState ? JSON.stringify(stateOf(world)) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

type Dollar = Parameters<TestBody>[0]

const run = async ($: Dollar, command: string, args = '') =>
  (await $.command.run({ command, args } as never)).text ?? ''

const nowOf = (list: string) => /^  ● (.+?)\s{2,}/m.exec(list)?.[1]

describe('/orca-game:view', () => {
  test('lists every view with its cost, marks the current one and flags the suggested one', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, worldOf())
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)

    const list = await run($, 'orca-game:view')
    expect(list.split('\n')).toEqual([
      'Game views (● now, ★ suggested for this machine):',
      '  ○ Off         light',
      '  ○ Flat        light   ★',
      '  ● Zen         medium',
      '  ○ 2D classic  medium',
      '  ○ 2D hd       heavy',
      '/orca-game:view <view> [pane|project|global]: pane (the default) changes this pane only, project stores it for this project on this machine, global for every project.'
    ])
  })

  test('changes this pane alone by default, and the old mode and render commands still map to a view', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf()
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)

    expect(await run($, 'orca-game:view', 'flat')).toBe('View: Flat, this pane only.')
    expect(nowOf(await run($, 'orca-game:view'))).toBe('Flat')
    expect(world.calls).toEqual([])
    await run($, 'orca-game:mode', 'on')
    await run($, 'orca-game:render', 'hd')
    expect(nowOf(await run($, 'orca-game:view'))).toBe('2D hd')
    await run($, 'quest', 'zen')
    expect(nowOf(await run($, 'orca-game:view'))).toBe('Zen')
  })

  test('stores this project through Orca and lets the pane follow it again', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf()
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)
    await run($, 'orca-game:view', 'flat')

    expect(await run($, 'orca-game:view', '2d-hd project')).toBe(
      'View: 2D hd, saved for this project on this machine.'
    )
    expect(world.calls).toEqual([
      [ORCA_CLI, 'game', 'view', '2d-hd', '--scope', 'project', '--json']
    ])
    expect(nowOf(await run($, 'orca-game:view'))).toBe('2D hd')
    // Why: with no pane override left, a later change in Settings reaches this pane on its next poll.
    world.config = { mode: 'zen', render: 'hd' }
    await clock.advance(POLL_MS)
    expect(nowOf(await run($, 'orca-game:view'))).toBe('Zen')
  })

  test('keeps the view on this pane and says so when Orca cannot store it', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf({ extra: {} })
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)

    expect((await run($, 'orca-game:view')).split('\n').at(-1)).toBe(
      '/orca-game:view <view>: changes this pane only; this Orca cannot store a view for a project or every project.'
    )
    expect(await run($, 'orca-game:view', 'flat global')).toBe(
      'View: Flat, this pane only: this Orca could not store it for every project.'
    )
    expect(world.calls).toEqual([])
    expect(nowOf(await run($, 'orca-game:view'))).toBe('Flat')
  })

  test('falls back to this pane when the CLI refuses the command', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf({ viewExit: 1 })
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)

    expect(await run($, 'orca-game:view', '2d-classic project')).toBe(
      'View: 2D classic, this pane only: this Orca could not store it for this project.'
    )
    expect(world.calls).toHaveLength(1)
    expect(nowOf(await run($, 'orca-game:view'))).toBe('2D classic')
  })

  test('says the project keeps its own view when every project changes under it', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf({
      extra: { viewScopes: ['project', 'global'], sources: { mode: 'local', render: 'global' } }
    })
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)

    expect(await run($, 'orca-game:view', 'flat global')).toBe(
      "View: Flat, saved for every project; this project's own setting keeps Zen here."
    )
    expect(world.calls).toHaveLength(1)
    expect(nowOf(await run($, 'orca-game:view'))).toBe('Zen')
  })
})
