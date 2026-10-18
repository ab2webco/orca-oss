// Runs under `claude plugin test`: the scene's pet, and Jev's advisor acting out its decisions.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin, TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUEST_SCENE } from '../hooks/scenes/quest'

const VIEWPORT = { columns: 170, rows: 40, isFullscreen: true } as const
const BAND = {
  component: 'AbovePrompt',
  viewport: VIEWPORT,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 8,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 7 },
    view: {}
  }
} as const
const PANE = {
  component: 'Pane',
  requestId: 'orca-game-fleet',
  viewport: VIEWPORT,
  props: {
    title: 'Fleet',
    isFocused: true,
    bodyColumns: 140,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {}
  }
} as const
const SPINNER = {
  component: 'Spinner',
  viewport: VIEWPORT,
  props: { word: 'Working', message: null, suffix: '', mode: 'thinking' }
} as const
const TURN = {
  reason: 'answer',
  answer: 'ok',
  durationMs: 1,
  isAborted: false,
  turnId: 't1'
} as const
const ORCA_CLI = '/opt/orca/bin/orca'
const GAME_STATE = [ORCA_CLI, 'game', 'state', '--json']

const WOLF = {
  name: { en: 'Wolf', es: 'Lobo' },
  frames: [['W...W', 'WWWWW', 'WEWEW', '.WWW.', '.W.W.']],
  happy: ['W...W', 'WWWWW', 'WHWHW', '.WWW.', '.W.W.'],
  colors: { W: 0xd8d8d8, E: 0x1a1a1a, H: 0xff5a8a }
}

const stateWith = (cast: unknown) => ({
  config: { scene: 'file:.orca/scenes/mc.json' },
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
  extensions: {
    scenes: [
      {
        id: 'file:.orca/scenes/mc.json',
        pluginId: 'file',
        definition: { ...QUEST_SCENE, id: 'file:.orca/scenes/mc.json', cast }
      }
    ]
  }
})

const engine = (on: On, env: Record<string, string>, cast: unknown) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI, ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    const isGame = e.argv.join(' ') === GAME_STATE.join(' ')
    return {
      value: {
        exitCode: isGame ? 0 : 1,
        stdout: isGame ? JSON.stringify(stateWith(cast)) : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

describe('the scene pet', () => {
  test('Pet names the scene pet in the band and the Panel, in the session language', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_LOCALE: 'es' }, { pet: WOLF })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await band.find({ type: 'Text', text: / ♥ Mimar a Lobo / })).toBeDefined()
    expect(await band.find({ type: 'Raster', key: 'band-pet-scene' })).toBeUndefined()
    await band.press({ key: 'band-pet' })
    expect(await band.find({ type: 'Raster', key: 'band-pet-scene' })).toBeDefined()
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Text', text: / ♥ Mimar a Lobo / })).toBeDefined()
    await pane.unmount()
  })

  test('a scene without a pet keeps a plain Pet for Clawd', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, {}, undefined)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
    expect(await band.find({ type: 'Text', text: /^ ♥ Pet $/ })).toBeDefined()
    await band.unmount()
  })
})

const subagent = (id: string, why: string, model: string, verdict: string) => ({
  id,
  type: 'general-purpose',
  title: `Task ${id}`,
  branch: null,
  worktree: null,
  model,
  effort: 'medium',
  status: 'running',
  why,
  verdict
})

const advisorWith = (subagents: unknown[]) => ({
  version: 1,
  locale: 'es',
  line: 'jev · agentes',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents,
  ci: [],
  notices: []
})

// Publishes TEST_ADVISOR at start and TEST_ADVISOR_NEXT after a turn, as Jev does in game mode.
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
    on('turn.complete', async ($, e, next) => {
      const raw = await $.env.get('TEST_ADVISOR_NEXT')
      if (raw !== undefined && raw !== null && raw !== '') {
        await $.state.set({ plugin: 'orca-jev-mod-skills', key: 'advisor' }, JSON.parse(raw))
      }
      return next(e)
    })
  }
}

// Reads the game's advisor log back, as another plugin could.
const READER: Plugin = {
  name: 'reader',
  register(on) {
    on('command.run', { command: 'advisor-log' }, async ($) => {
      const read = await $.state.get({ plugin: 'orca-game', key: 'advisor' })
      return { text: JSON.stringify(read.value?.decisions ?? []) }
    })
  }
}

const WITH_JEV = { plugins: [JEV, READER] }

const FIRST = JSON.stringify(advisorWith([subagent('a1', 'inherited', 'Opus 5.5', 'igual')]))
const LOWERED = JSON.stringify(
  advisorWith([
    subagent('a1', 'inherited', 'Opus 5.5', 'igual'),
    subagent('a2', 'lowered', 'Sonnet 5', 'Sonnet basta')
  ])
)

const spinnerCells = async ($: Parameters<TestBody>[0]) => {
  const spinner = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...SPINNER })
  const raster = await spinner.find({ type: 'Raster' })
  await spinner.unmount()
  return raster?.props.cells
}

describe('Jev’s advisor', () => {
  test('stands in the scene only while Jev’s value is there to read', WITH_JEV, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { TEST_ADVISOR: FIRST, TEST_ADVISOR_NEXT: '{"version":2}' }, undefined)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const withJev = await spinnerCells($)
    expect(withJev).toBeDefined()
    expect(await spinnerCells($)).toBe(withJev)
    await $.turn.complete(TURN)
    await clock.settle()
    const without = await spinnerCells($)
    expect(without).toBeDefined()
    expect(without).not.toBe(withJev)
  })

  test(
    'stands in the hd scene only while Jev’s value is there to read',
    WITH_JEV,
    async ($, on) => {
      const clock = mock.clock(on)
      const env = {
        ORCA_GAME_RENDER: 'hd',
        TEST_ADVISOR: FIRST,
        TEST_ADVISOR_NEXT: '{"version":2}'
      }
      engine(on, env, undefined)
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      const withJev = await spinnerCells($)
      expect(withJev).toBeDefined()
      await $.turn.complete(TURN)
      await clock.settle()
      expect(await spinnerCells($)).not.toBe(withJev)
    }
  )

  test('acts out a lowered model and logs it for the Panel', WITH_JEV, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { TEST_ADVISOR: FIRST, TEST_ADVISOR_NEXT: LOWERED }, undefined)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const idle = await spinnerCells($)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(await spinnerCells($)).not.toBe(idle)
    const said = await $.command.run({ command: 'advisor-log', args: '' } as never)
    const log = JSON.parse(said.text ?? '[]') as { verdict: string; gesture: string | null }[]
    expect(log.map((one) => one.verdict)).toEqual(['igual', 'Sonnet basta'])
    expect(log.at(-1)?.gesture).toBe('lowered')
  })

  test('is not drawn while the game leaves Jev its own band', WITH_JEV, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { TEST_ADVISOR: '', TEST_ADVISOR_NEXT: LOWERED, ORCA_GAME_HUD: '0' }, undefined)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const before = await spinnerCells($)
    await $.turn.complete(TURN)
    await clock.settle()
    expect(await spinnerCells($)).toBe(before)
  })

  test(
    'has a Panel card with its name, the main model and its last decisions',
    WITH_JEV,
    async ($, on) => {
      const clock = mock.clock(on)
      engine(
        on,
        { TEST_ADVISOR: FIRST, TEST_ADVISOR_NEXT: LOWERED, ORCA_GAME_LOCALE: 'es' },
        undefined
      )
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      await $.turn.complete(TURN)
      await clock.settle()
      const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
      const card = await pane.find({ type: 'Box', key: 'advisor-card' })
      expect(card).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Árbitro/ })).toBeDefined()
      expect(
        await pane.find({ type: 'Text', text: '★ conversación principal · Opus 5.5·high' })
      ).toBeDefined()
      expect(
        await pane.find({ type: 'Text', text: /Task a2 · Sonnet 5·medium · Sonnet basta/ })
      ).toBeDefined()
      expect(
        await pane.find({ type: 'Text', text: /Task a1 · Opus 5\.5·medium · igual/ })
      ).toBeDefined()
      const tile = await pane.find({ type: 'Raster', key: 'advisor-tile' })
      expect(tile?.props).toMatchObject({ columns: 22, rows: 4 })
      await pane.unmount()
    }
  )

  test('has no Panel card without Jev', WITH_JEV, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, {}, undefined)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const pane = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Text', text: /^ ♥ Pet $/ })).toBeDefined()
    expect(await pane.find({ type: 'Box', key: 'advisor-card' })).toBeUndefined()
    expect(await pane.find({ type: 'Raster', key: 'advisor-tile' })).toBeUndefined()
    await pane.unmount()
  })

  test(
    'shows the scene above the band to act out CI while the lead is idle, then leaves',
    WITH_JEV,
    async ($, on) => {
      const failed = JSON.stringify({
        ...JSON.parse(FIRST),
        ci: [
          {
            id: 'c1',
            sha7: 'abc1234',
            branch: null,
            status: 'failure',
            done: 5,
            total: 5,
            failed: ['lint'],
            running: [],
            text: 'CI abc1234 failed: lint',
            startedAtMs: 1,
            finishedAtMs: 2
          }
        ]
      })
      const clock = mock.clock(on)
      engine(on, { TEST_ADVISOR: FIRST, TEST_ADVISOR_NEXT: failed }, undefined)
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      const sceneInBand = async () => {
        const band = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
        const raster = await band.find({ type: 'Raster', key: 'band-pet-scene' })
        await band.unmount()
        return raster
      }
      expect(await sceneInBand()).toBeUndefined()
      await $.turn.complete(TURN)
      await clock.settle()
      expect(await sceneInBand()).toBeDefined()
      await clock.advance(10_000)
      expect(await sceneInBand()).toBeUndefined()
    }
  )
})
