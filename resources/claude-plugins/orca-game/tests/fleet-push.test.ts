// Runs under `claude plugin test`: the band follows a fleet change Orca pushes, and ages a fleet a failed read kept.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const member = (paneKey: string) => ({
  paneKey,
  displayName: `Merlin · ${paneKey}`,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false
})

const leadState = (agents: object[]) => ({
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'main', displayName: 'orca' },
  agents,
  review: null,
  workItem: null,
  lead: { autostart: false, cap: 4, label: 'Orca' },
  role: 'lead'
})

type Drawn = { children?: unknown }
const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  const children = typeof one === 'object' && one !== null ? (one as Drawn).children : undefined
  return Array.isArray(children) ? children.map(shownOf).join('') : ''
}

/** A `game state` Orca answers with `reply()`, and a `game watch` the test writes lines to. */
const mountBand = async ($: Engine, on: On, reply: () => object | undefined) => {
  const clock = mock.clock(on)
  let reads = 0
  const lines: string[] = ['ready 1\n']
  let wake: (() => void) | null = null
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('command.run', () => ({ text: '' }) as never)
  on('process.run', (_$, e) => {
    const isState = e.argv.includes('state')
    reads += isState ? 1 : 0
    const state = isState ? reply() : undefined
    return {
      value: {
        exitCode: state === undefined ? 1 : 0,
        stdout: state === undefined ? '' : JSON.stringify(state),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  on('process.spawn', async function* () {
    for (;;) {
      const line = lines.shift()
      if (line !== undefined) {
        yield { stream: 'stdout' as const, text: line }
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  const ui = await $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns: 124, rows: 40, isFullscreen: true },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 8,
      scroll: { offset: 0, bodyRows: 7 },
      view: {},
      bodyColumns: 120
    }
  })
  const push = async (line: string) => {
    lines.push(line)
    wake?.()
    await clock.settle()
  }
  const shown = async () => (await ui.findAll({ type: 'Text' })).map(shownOf).join('\n')
  return { clock, push, shown, reads: () => reads }
}

describe('a fleet change Orca pushes', () => {
  test('redraws the band within the debounce, with no poll, turn or Refresh', async ($, on) => {
    let agents: object[] = []
    const band = await mountBand($, on, () => leadState(agents))
    await band.clock.advance(1000)
    const before = band.reads()
    expect(await band.shown()).toContain('0 working')

    agents = [member('m1')]
    await band.push('fleet 2\n')
    await band.clock.advance(300)
    await band.clock.settle()

    expect(band.reads()).toBe(before + 1)
    expect(await band.shown()).toContain('1 working')
  })

  test('a burst of changes is one read', async ($, on) => {
    const band = await mountBand($, on, () => leadState([]))
    await band.clock.advance(1000)
    const before = band.reads()

    await band.push('fleet 2\nfleet 3\n')
    await band.push('fleet 4\n')
    await band.clock.advance(300)
    await band.clock.settle()

    expect(band.reads()).toBe(before + 1)
  })
})

describe('a read that fails after one that answered', () => {
  test('keeps the fleet, says how old it is, and retries before the poll', async ($, on) => {
    let isUp = true
    const band = await mountBand($, on, () => (isUp ? leadState([member('m1')]) : undefined))
    await band.clock.advance(1000)

    isUp = false
    await band.push('fleet 2\n')
    await band.clock.advance(300)
    await band.clock.settle()
    await band.clock.advance(5000)

    const shown = await band.shown()
    expect(shown).toContain('1 working')
    expect(shown).toMatch(/updated \d+ s ago · retrying/)

    const before = band.reads()
    isUp = true
    await band.clock.advance(10000)
    await band.clock.settle()
    expect(band.reads()).toBe(before + 1)
    expect(await band.shown()).not.toContain('retrying')
  })
})
