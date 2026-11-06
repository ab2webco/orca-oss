// Runs under `claude plugin test`: the render a session keeps, from the env, Orca's live config and /quest.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const ORCA_CLI = '/opt/orca/bin/orca'
const GAME_STATE = [ORCA_CLI, 'game', 'state', '--json']
const POLL_MS = 30000

type Agent = { paneKey: string; displayName: string; state: string; isLeader: boolean }

const agent = (name: string, state: string, isLeader = false): Agent => ({
  paneKey: `tab-1:${name}`,
  displayName: name,
  state,
  isLeader
})

type World = {
  config: Record<string, unknown>
  sources: Record<string, string>
  agents: Agent[]
  review: Record<string, unknown> | null
  extra: Record<string, unknown>
}

const worldOf = (patch: Partial<World> = {}): World => ({
  config: {},
  sources: {},
  agents: [agent('lead', 'working', true)],
  review: null,
  extra: {},
  ...patch
})

const stateOf = (world: World) => ({
  config: world.config,
  sources: world.sources,
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: world.agents.map((one) => ({ agentType: 'claude', toolName: null, ...one })),
  review: world.review,
  workItem: null,
  links: [],
  extensions: { scenes: [] },
  ...world.extra
})

const engine = (on: On, env: Record<string, string>, world: World = worldOf()) => {
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
        stdout: isGame ? JSON.stringify(stateOf(world)) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

type Dollar = Parameters<TestBody>[0]

const quest = async ($: Dollar, args: string) =>
  (await $.command.run({ command: 'quest', args } as never)).text ?? ''

describe('/quest render', () => {
  test('shows the render beside the mode and overrides it for the session', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, {})
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: classic\. /)
    expect(await quest($, 'render hd')).toBe(
      "Render: hd (this session; the project's setting is classic)."
    )
    expect(await quest($, '')).toMatch(
      /^Quest: on\. Render: hd \(this session; the project's setting is classic\)\. /
    )
    expect(await quest($, 'render neon')).toBe(
      'Unknown render "neon". Use /orca-game:render classic, hd or hd-compact.'
    )
    expect(await quest($, 'render classic')).toBe('Render: classic.')
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: classic\. /)
  })

  // Why: `game state` reports the config layers only, so a pane override must say it is one.
  test('names the configured value and its layer beside a session override', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf({
      config: { mode: 'on', render: 'classic' },
      sources: { mode: 'project', render: 'default' }
    })
    engine(on, {}, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)
    const render = "hd (this session; the project's setting is classic, from default)"
    expect(await quest($, 'render hd')).toBe(`Render: ${render}.`)
    const mode = "zen (this session; the project's setting is on, from project)"
    expect(await quest($, 'zen')).toBe(`Quest: ${mode}.`)
    expect(await quest($, '')).toContain(
      `Quest: ${mode}. Render: ${render}. /orca-game:mode on|zen|off: `
    )
    expect(await quest($, 'on')).toBe('Quest: on.')
    expect(await quest($, 'render classic')).toBe('Render: classic.')
  })

  test('says it in Spanish', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_LOCALE: 'es' }, worldOf({ sources: { render: 'default' } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)
    expect(await quest($, 'render hd')).toBe(
      'Render: hd (solo esta sesión; la configuración del proyecto es classic, de default).'
    )
  })

  test('starts from the launch env and follows Orca’s live config', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_RENDER: 'hd' }, worldOf({ config: { render: 'classic' } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: classic\. /)
  })
})

const run = async ($: Dollar, command: string, args = '') =>
  (await $.command.run({ command, args } as never)).text ?? ''

// Why: the game's own commands live under /orca-game:, so typing it lists them all.
describe('the /orca-game: commands', () => {
  test('mode, render and demo split /quest, and quest is its long form', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf({
      config: { mode: 'on', render: 'classic' },
      sources: { mode: 'default', render: 'default' }
    })
    engine(on, {}, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)
    expect(await run($, 'orca-game:render', 'hd')).toBe(
      "Render: hd (this session; the project's setting is classic, from default)."
    )
    expect(await run($, 'orca-game:mode', 'zen')).toBe(
      "Quest: zen (this session; the project's setting is on, from default)."
    )
    const shown = await run($, 'orca-game:quest')
    expect(shown).toMatch(
      /^Quest: zen \(.+\)\. Render: hd \(.+\)\. \/orca-game:mode on\|zen\|off: /
    )
    expect(await run($, 'orca-game:mode')).toBe(shown)
    expect(await run($, 'orca-game:render')).toBe(shown)
    expect(await run($, 'orca-game:quest', 'render classic')).toBe('Render: classic.')
    expect(await run($, 'orca-game:mode', 'render')).toBe(
      'Unknown mode "render". Use /orca-game:mode on, /orca-game:mode zen, /orca-game:mode flat, /orca-game:mode off or /orca-game:demo.'
    )
    expect(await run($, 'orca-game:render', 'neon')).toBe(
      'Unknown render "neon". Use /orca-game:render classic, hd or hd-compact.'
    )
    expect(await run($, 'orca-game:demo')).toBe(
      'The demo and the arcade play in the Team panel; this pane keeps the text.'
    )
    expect(await run($, 'quest', 'on')).toBe('Quest: on.')
  })
})
