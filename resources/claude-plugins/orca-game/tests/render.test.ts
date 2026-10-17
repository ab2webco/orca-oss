// Runs under `claude plugin test`: the render a session draws, from the env, Orca's live config and /quest,
// and what the hd scene learns from the clock and each refresh.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const spinnerOf = (rows: number) =>
  ({
    component: 'Spinner',
    viewport: { columns: 130, rows, isFullscreen: true },
    props: { word: 'Working', message: null, suffix: '', mode: 'thinking' }
  }) as const
const ORCA_CLI = '/opt/orca/bin/orca'
const GAME_STATE = [ORCA_CLI, 'game', 'state', '--json']
const POLL_MS = 30000
const HOUR_MS = 3600000

type Agent = { paneKey: string; displayName: string; state: string; isLeader: boolean }

const agent = (name: string, state: string, isLeader = false): Agent => ({
  paneKey: `tab-1:${name}`,
  displayName: name,
  state,
  isLeader
})

type World = {
  config: Record<string, unknown>
  agents: Agent[]
  review: Record<string, unknown> | null
  extra: Record<string, unknown>
}

const worldOf = (patch: Partial<World> = {}): World => ({
  config: {},
  agents: [agent('lead', 'working', true)],
  review: null,
  extra: {},
  ...patch
})

const stateOf = (world: World) => ({
  config: world.config,
  sources: {},
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

const rasterOf = async ($: Dollar, rows: number) => {
  const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...spinnerOf(rows) })
  const raster = await spinner.find({ type: 'Raster' })
  await spinner.unmount()
  return raster?.props
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The Raster's cells back as [codepoint, fg, bg] triples. */
const cellsOf = (encoded: string): number[][] => {
  const bytes: number[] = []
  for (let i = 0; i + 3 < encoded.length; i += 4) {
    const word = Array.from(encoded.slice(i, i + 4), (one) =>
      one === '=' ? 0 : BASE64.indexOf(one)
    )
    const n =
      ((word[0] ?? 0) << 18) | ((word[1] ?? 0) << 12) | ((word[2] ?? 0) << 6) | (word[3] ?? 0)
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const words: number[] = []
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) |
        ((bytes[i + 1] ?? 0) << 8) |
        ((bytes[i + 2] ?? 0) << 16) |
        ((bytes[i + 3] ?? 0) << 24)) >>>
        0
    )
  }
  const cells: number[][] = []
  for (let i = 0; i + 2 < words.length; i += 3) {
    cells.push([words[i] ?? 0, words[i + 1] ?? 0, words[i + 2] ?? 0])
  }
  return cells
}

const sceneOf = async ($: Dollar) => cellsOf(String((await rasterOf($, 40))?.cells ?? ''))
const textOf = (cells: number[][]) =>
  cells.map((one) => (one[0] === 0x2580 ? '' : String.fromCodePoint(one[0] ?? 32))).join('')
const pixelsOf = (cells: number[][]) =>
  new Set(cells.flatMap((one) => (one[0] === 0x2580 ? [one[1], one[2]] : [])))

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
    engine(on, { ORCA_GAME_RENDER: 'hd' }, worldOf({ config: { render: 'classic' } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(await quest($, '')).toMatch(/^Quest: on\. Render: classic\. /)
  })
})

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

  test('turns to night by the project’s timezone, with stars or the moon', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 16, 22, 0) })
    const world = worldOf()
    engine(on, { ORCA_GAME_RENDER: 'hd', ORCA_GAME_TIMEZONE: 'UTC' }, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const night = pixelsOf(await sceneOf($))
    expect(night.has(0xf5f3c8) || night.has(0xe8ecff)).toBe(true)
    world.config = { timezone: 'Asia/Tokyo' }
    await clock.advance(POLL_MS)
    const day = pixelsOf(await sceneOf($))
    expect(day.has(0xf5f3c8) || day.has(0xe8ecff)).toBe(false)
  })

  test('crowns the lead under its own label', async ($, on) => {
    const clock = mock.clock(on)
    const world = worldOf({
      extra: { role: 'lead', lead: { autostart: false, cap: 4, label: 'Boss' } }
    })
    engine(on, { ORCA_GAME_RENDER: 'hd' }, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(POLL_MS)
    expect(textOf((await sceneOf($)).slice(8 * 130))).toContain('Boss')
  })

  test('floats a teammate starting to wait, and a merge with its XP', async ($, on) => {
    const clock = mock.clock(on, { now: HOUR_MS * 12 })
    const world = worldOf({
      agents: [agent('lead', 'working', true), agent('ana', 'working')],
      review: {
        provider: 'github',
        number: 42,
        title: 't',
        url: 'https://x/42',
        state: 'open',
        ci: 'pending'
      }
    })
    engine(on, { ORCA_GAME_RENDER: 'hd' }, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    world.agents = [agent('lead', 'working', true), agent('ana', 'waiting')]
    await clock.advance(POLL_MS)
    const floated = (await sceneOf($)).filter((one) => one[1] === 0xff4a4a && one[0] !== 0x2580)
    expect(textOf(floated)).toContain('ana needs you!')
    world.review = { ...world.review, state: 'merged' }
    await clock.advance(POLL_MS)
    expect(textOf(await sceneOf($))).toContain('#42 merged!')
  })
})
