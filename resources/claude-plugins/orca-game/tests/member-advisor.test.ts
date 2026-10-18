// Runs under `claude plugin test`: a member pane tells Orca what its Jev has it on, for the lead's Panel.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe'
const STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: null,
  agents: [],
  review: null,
  workItem: null,
  role: 'member'
}

const advisorOn = (model: string, effort: string | number) => ({
  version: 1,
  locale: 'en',
  line: 'jev',
  model,
  modelId: 'claude-x',
  effort,
  subagents: [],
  ci: [],
  notices: []
})

// Publishes TEST_ADVISOR at start and TEST_ADVISOR_NEXT on /jev-next, as Jev does in a game pane.
const JEV: Plugin = {
  name: 'orca-jev-mod-skills',
  register(on) {
    on('session.start', async ($, e, next) => {
      const raw = await $.env.get('TEST_ADVISOR')
      if (raw !== undefined && raw !== null && raw !== '') {
        await $.state.set({ plugin: 'orca-jev-mod-skills', key: 'advisor' }, JSON.parse(raw))
      }
      return next(e)
    })
    on('command.run', { command: 'jev-next' }, async ($) => {
      const raw = await $.env.get('TEST_ADVISOR_NEXT')
      if (raw !== undefined && raw !== null && raw !== '') {
        await $.state.set({ plugin: 'orca-jev-mod-skills', key: 'advisor' }, JSON.parse(raw))
      }
      return { text: '' }
    })
  }
}
const WITH_JEV = { plugins: [JEV] }

type Run = { argv: string[]; env: Record<string, string> | undefined }

const engine = (on: On, env: Record<string, string>, runs: Run[], state: unknown = STATE) => {
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ComSpec: COMSPEC, ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env })
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify(state),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

const start = async (
  $: Engine,
  on: On,
  env: Record<string, string>,
  runs: Run[],
  state: unknown = STATE
) => {
  const clock = mock.clock(on)
  engine(on, env, runs, state)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return clock
}

const TURN = {
  reason: 'answer',
  answer: 'ok',
  durationMs: 1,
  isAborted: false,
  turnId: 't1'
} as const

const reportsOf = (runs: readonly Run[]): unknown[] =>
  runs
    .filter((one) => one.argv.includes('state') || one.env?.ORCA_GAME_CLI_LINE?.includes('state'))
    .map((one) => {
      const raw = one.env?.ORCA_GAME_ADVISOR
      return raw === undefined ? undefined : (JSON.parse(raw) as unknown)
    })

describe("a member pane's Jev report", () => {
  test(
    'rides the state poll with the model, the effort and Orca’s pins',
    WITH_JEV,
    async ($, on) => {
      const runs: Run[] = []
      const env = {
        TEST_ADVISOR: JSON.stringify(advisorOn('Sonnet 5.5', 3)),
        ORCA_AGENT_MODEL_PINNED: '1'
      }
      const clock = await start($, on, env, runs)
      await $.turn.complete(TURN)
      await clock.settle()
      expect(reportsOf(runs).at(-1)).toEqual({
        version: 1,
        model: 'Sonnet 5.5',
        effort: '3',
        pinned: { model: true, effort: false }
      })
    }
  )

  test('a pane where Jev never published sends no report at all', async ($, on) => {
    const runs: Run[] = []
    const clock = await start($, on, {}, runs)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every((one) => one.env === undefined)).toBe(true)
  })

  test('a switch of model reaches Orca without waiting for the poll', WITH_JEV, async ($, on) => {
    const runs: Run[] = []
    const env = {
      TEST_ADVISOR: JSON.stringify(advisorOn('Opus 5.5', 'high')),
      TEST_ADVISOR_NEXT: JSON.stringify(advisorOn('Sonnet 5.5', 'high'))
    }
    const clock = await start($, on, env, runs)
    const before = runs.length
    await $.command.run({ command: 'jev-next', args: '' } as never)
    await clock.settle()
    expect(runs.length).toBeGreaterThan(before)
    expect(reportsOf(runs).at(-1)).toMatchObject({ model: 'Sonnet 5.5', effort: 'high' })
  })

  test(
    'once Jev stops, the next poll says so once, then sends nothing',
    WITH_JEV,
    async ($, on) => {
      const runs: Run[] = []
      const env = {
        TEST_ADVISOR: JSON.stringify(advisorOn('Opus 5.5', 'high')),
        TEST_ADVISOR_NEXT: '{"version":2}'
      }
      const clock = await start($, on, env, runs)
      await $.turn.complete(TURN)
      await clock.settle()
      await $.command.run({ command: 'jev-next', args: '' } as never)
      await $.turn.complete(TURN)
      await clock.settle()
      await $.turn.complete(TURN)
      await clock.settle()
      expect(reportsOf(runs).slice(-2)).toEqual([null, undefined])
    }
  )

  test('a Windows .cmd CLI gets the report beside its command line', WITH_JEV, async ($, on) => {
    const runs: Run[] = []
    const env = {
      ORCA_GAME_CLI: 'C:\\Orca\\orca.cmd',
      TEST_ADVISOR: JSON.stringify(advisorOn('Opus 5.5', 'high')),
      ORCA_AGENT_EFFORT_PINNED: '1'
    }
    const clock = await start($, on, env, runs)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(runs.at(-1)?.env).toEqual({
      ORCA_GAME_CLI_LINE: '"C:\\Orca\\orca.cmd" "game" "state" "--json"',
      ORCA_GAME_ADVISOR: JSON.stringify({
        version: 1,
        model: 'Opus 5.5',
        effort: 'high',
        pinned: { model: false, effort: true }
      })
    })
  })
})

const member = (advisor?: unknown) => ({
  paneKey: 'tab-4:m',
  displayName: 'CIN-5',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...(advisor === undefined ? {} : { advisor })
})

const leadState = (advisor?: unknown) => ({
  ...STATE,
  role: 'lead',
  agents: [
    { ...member(), paneKey: 'tab-1:lead', displayName: 'lead', isLeader: true, isMember: false },
    member(advisor)
  ]
})

const pane = ($: Engine) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'orca-game-fleet',
    viewport: { columns: 124, rows: 60, isFullscreen: true },
    props: {
      title: 'Fleet',
      isFocused: true,
      bodyColumns: 120,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 50 },
      view: {}
    }
  })

describe("the lead's Panel", () => {
  test("shows on a member's card what its Jev has it on, and sums up the fleet", async ($, on) => {
    const advisor = {
      model: 'Sonnet 5.5',
      effort: 'high',
      pinned: { model: true, effort: false },
      previous: { model: 'Opus 5.5', effort: 'high' }
    }
    await start($, on, {}, [], leadState(advisor))
    const ui = await pane($)
    const head = '◆ Jev Sonnet 5.5·high · model pinned'
    expect(await ui.find({ type: 'Text', text: head })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↳ Opus 5.5 → Sonnet 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◆ 1 on Sonnet 5.5' })).toBeDefined()
    await ui.unmount()
  })

  // Why: one font size, so the ticket id is its own bold Text and the title a plain one below it.
  test("ranks a member's card by color and weight, the branch without refs/heads/", async ($, on) => {
    const state = leadState()
    const long = {
      ...state.agents[1],
      displayName: 'ORCA-601 El lead del juego delega en subagentes internos de...',
      toolName: 'Bash',
      worktree: { id: 'w', branch: 'refs/heads/fabolivark/orca-601', displayName: 'orca-601' }
    }
    await start($, on, {}, [], { ...state, agents: [state.agents[0], long] })
    const ui = await pane($)
    expect((await ui.find({ type: 'Text', text: /^ORCA-601$/ }))?.props.bold).toBe(true)
    const title = await ui.find({ type: 'Text', text: /^El lead del juego/ })
    expect(title?.text).toBe('El lead del juego delega en subagentes internos…')
    expect(title?.props.bold).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^working$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fabolivark\/orca-601$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /refs\/heads/ })).toBeUndefined()
    await ui.unmount()
  })

  test(
    "names the lead's own row and model, and wraps Jev's line instead of cutting it",
    WITH_JEV,
    async ($, on) => {
      const line = 'jev · herramienta: PushNotification (aplicada) · modelo: Opus 5.5 se mantiene'
      const env = {
        TEST_ADVISOR: JSON.stringify({ ...advisorOn('Opus 5.5', 'high'), line }),
        ORCA_AGENT_MODEL_PINNED: '1'
      }
      await start($, on, env, [], leadState())
      const ui = await pane($)
      expect(
        await ui.find({ type: 'Text', text: '◆ Jev Opus 5.5·high · model pinned' })
      ).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '★ lead · Opus 5.5·high' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /main conversation/ })).toBeUndefined()
      // Why `?? 'wrap'`: the engine leaves its default out of the props it reports.
      const wrapOf = async (text: string) => {
        const found = await ui.find({ type: 'Text', text })
        return found === undefined ? undefined : (found.props.wrap ?? 'wrap')
      }
      expect(await wrapOf('◆ Wizard')).toBe('wrap')
      expect(await wrapOf(line)).toBe('wrap')
      expect(await wrapOf('★ lead · Opus 5.5·high')).toBe('wrap')
      await ui.unmount()
    }
  )

  test(
    "a member pane's card names its own main conversation, not the lead",
    WITH_JEV,
    async ($, on) => {
      const env = { TEST_ADVISOR: JSON.stringify(advisorOn('Sonnet 5.5', 'high')) }
      await start($, on, env, [], { ...leadState(), role: 'member' })
      const ui = await pane($)
      expect(
        await ui.find({ type: 'Text', text: '★ main conversation · Sonnet 5.5·high' })
      ).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^◆ Jev / })).toBeUndefined()
      await ui.unmount()
    }
  )

  test(
    'names the model Orca launched a member on, on its card and under the lead',
    WITH_JEV,
    async ($, on) => {
      const env = { TEST_ADVISOR: JSON.stringify(advisorOn('Opus 5.5', 'high')) }
      const state = leadState()
      const launched = { ...state.agents[1], launch: { model: 'Opus 5.5', effort: 'high' } }
      await start($, on, env, [], { ...state, agents: [state.agents[0], launched] })
      const ui = await pane($)
      expect(await ui.find({ type: 'Text', text: '◇ Opus 5.5·high' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '◇ CIN-5 · Opus 5.5·high' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '◆ 1 on Opus 5.5' })).toBeDefined()
      await ui.unmount()
    }
  )

  // Why: a light theme paints the Panel near-white, where the scene's parchment cannot be read.
  test(
    "draws the advisor card's lead and member rows in the terminal's own color",
    WITH_JEV,
    async ($, on) => {
      const env = { TEST_ADVISOR: JSON.stringify(advisorOn('Opus 5.5', 'high')) }
      const state = leadState()
      const launched = { ...state.agents[1], launch: { model: 'Opus 5.5', effort: 'high' } }
      await start($, on, env, [], { ...state, agents: [state.agents[0], launched] })
      const ui = await pane($)
      const lead = await ui.find({ type: 'Text', text: '★ lead · Opus 5.5·high' })
      const row = await ui.find({ type: 'Text', text: '◇ CIN-5 · Opus 5.5·high' })
      expect(lead).toBeDefined()
      expect(row).toBeDefined()
      expect(lead?.props.color).toBeUndefined()
      expect(row?.props.color).toBeUndefined()
      await ui.unmount()
    }
  )

  test("wraps a member card's model line instead of cutting it", WITH_JEV, async ($, on) => {
    const state = leadState()
    const launched = { ...state.agents[1], launch: { model: 'Opus 5.5', effort: 'high' } }
    await start($, on, {}, [], { ...state, agents: [state.agents[0], launched] })
    const ui = await pane($)
    const line = await ui.find({ type: 'Text', text: '◇ Opus 5.5·high' })
    expect(line).toBeDefined()
    expect(line?.props.wrap ?? 'wrap').toBe('wrap')
    await ui.unmount()
  })

  test('draws no Jev row for a member whose Orca or Jev sends none', async ($, on) => {
    await start($, on, {}, [], leadState())
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: /◆/ })).toBeUndefined()
    await ui.unmount()
  })
})
