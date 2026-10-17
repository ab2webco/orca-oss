// Runs under `claude plugin test`: the render a session draws, from the env, Orca's live config and /quest.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const spinnerOf = (rows: number) =>
  ({
    component: 'Spinner',
    viewport: { columns: 130, rows, isFullscreen: true },
    props: { word: 'Working', message: null, suffix: '', mode: 'thinking' }
  }) as const
const ORCA_CLI = '/opt/orca/bin/orca'
const GAME_STATE = [ORCA_CLI, 'game', 'state', '--json']

const stateWith = (config: Record<string, unknown>) => ({
  config,
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    {
      paneKey: 'tab-1:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  links: [],
  extensions: { scenes: [] }
})

const engine = (on: On, env: Record<string, string>, live: Record<string, unknown> = {}) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    const isGame = e.argv.join(' ') === GAME_STATE.join(' ')
    return {
      value: {
        exitCode: isGame ? 0 : 1,
        stdout: isGame ? JSON.stringify(stateWith(live)) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

const quest = async ($: Parameters<Parameters<typeof test>[1]>[0], args: string) =>
  (await $.command.run({ command: 'quest', args } as never)).text ?? ''

describe('/quest render', () => {
  test('shows the render beside the mode and overrides it for the session', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, {})
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: classic\. /)
    expect(await quest($, 'render hd')).toBe('Render: hd.')
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: hd\. /)
    expect(await quest($, 'render neon')).toBe(
      'Unknown render "neon". Use /quest render classic or /quest render hd.'
    )
    expect(await quest($, 'render classic')).toBe('Render: classic.')
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: classic\. /)
  })

  test('starts from the launch env and follows Orca’s live config', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_RENDER: 'hd', ORCA_GAME_TIMEZONE: 'Asia/Tokyo' }, { render: 'classic' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: classic\. /)
  })
})

const rasterOf = async ($: Parameters<Parameters<typeof test>[1]>[0], rows: number) => {
  const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...spinnerOf(rows) })
  const raster = await spinner.find({ type: 'Raster' })
  await spinner.unmount()
  return raster?.props
}

describe('the hd scene above the spinner', () => {
  test('draws 9 rows, 10 on a tall terminal, and back to 5 in classic', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_RENDER: 'hd' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect((await rasterOf($, 40))?.rows).toBe(9)
    expect((await rasterOf($, 60))?.rows).toBe(10)
    await quest($, 'render classic')
    expect((await rasterOf($, 60))?.rows).toBe(5)
  })
})
