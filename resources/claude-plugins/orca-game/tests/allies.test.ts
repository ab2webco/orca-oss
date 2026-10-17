// Runs under `claude plugin test`: other plugins sharing the pane show up inside the game.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
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
const TURN = {
  reason: 'answer',
  answer: 'ok',
  durationMs: 1,
  isAborted: false,
  turnId: 't1'
} as const

const ADVISOR = {
  version: 1,
  locale: 'es',
  line: 'jev · 2 agentes',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [
    {
      id: 'a1',
      type: 'general-purpose',
      title: 'Write the strip',
      branch: 'feat/x',
      worktree: null,
      model: 'Sonnet 5',
      effort: 'medium',
      status: 'running',
      why: 'lowered',
      verdict: 'Jev baja'
    }
  ],
  ci: [
    {
      id: 'c1',
      sha7: 'abc1234',
      branch: 'feat/x',
      status: 'watching',
      done: 3,
      total: 5,
      failed: [],
      running: ['lint'],
      text: 'CI abc1234 3/5',
      startedAtMs: 1,
      finishedAtMs: null
    }
  ],
  notices: [
    { id: 'n1', level: 'info', text: 'old notice', at: 1 },
    { id: 'n2', level: 'warn', text: 'Run /clear soon', at: 2 }
  ]
}

// Inline plugins close over nothing of this file, so they read what to do from the env.
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
  }
}

const SCOUT: Plugin = {
  name: 'scout',
  register(on) {
    on('session.start', async ($, e, next) => {
      $.ui.status('3 scouts out')
      return next(e)
    })
    on('turn.complete', async ($, e, next) => {
      if ((await $.env.get('TEST_SCOUT_CLEARS')) === '1') {
        $.ui.status(undefined)
      }
      return next(e)
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: ['scout band'] })
    })
  }
}

const HERALD: Plugin = {
  name: 'herald',
  register(on) {
    on('turn.complete', ($, e, next) => {
      $.ui.status('herald arrived')
      return next(e)
    })
  }
}

type Status = { text: string | undefined; origin: string }

const engine = (on: On, env: Record<string, string>, statuses: Status[]) => {
  mock.env(on, { TEST_ADVISOR: JSON.stringify(ADVISOR), ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', ($s, e, next) => {
    statuses.push({ text: e.text, origin: next.origin.plugin })
    return { value: undefined }
  })
  on('process.run', () => ({
    value: {
      exitCode: 1,
      stdout: '',
      stderr: 'no',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
}

// What a plugin like Jev reads: the game's own `absorbing` value.
const READER: Plugin = {
  name: 'reader',
  register(on) {
    on('command.run', { command: 'absorbing' }, async ($) => {
      const read = await $.state.get({ plugin: 'orca-game', key: 'absorbing' })
      return { text: String(read.value) }
    })
  }
}

const ALL = { plugins: [JEV, SCOUT, HERALD, READER] }

describe('allies strip', () => {
  test(
    'in game mode it draws Jev and a plugin status, and the engine gets no status from them',
    ALL,
    async ($, on) => {
      const statuses: Status[] = []
      const clock = mock.clock(on)
      engine(on, {}, statuses)
      await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/w'
      })
      await clock.settle()
      const ui = await $.ui.mount({
        plugin: 'orca-game',
        surface: 'terminal',
        ...BAND
      })
      const line = await ui.find({ type: 'Text', text: /^ jev · 2 agentes$/ })
      expect(line?.props.color).toBe(QUEST_SCENE.band.parchment)
      expect(await ui.find({ type: 'Text', text: /^ Opus 5\.5·high $/ })).toBeDefined()
      expect(
        await ui.find({
          type: 'Text',
          text: /Write the strip · Sonnet 5 · Jev baja/
        })
      ).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /CI abc1234 3\/5/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Run \/clear soon/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /old notice/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^ scout $/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^ 3 scouts out$/ })).toBeDefined()
      await ui.unmount()
      expect(statuses.filter((one) => one.origin === 'scout')).toEqual([])
    }
  )

  test('a status cleared to undefined takes its row away', ALL, async ($, on) => {
    const statuses: Status[] = []
    const clock = mock.clock(on)
    engine(on, { TEST_SCOUT_CLEARS: '1' }, statuses)
    await $.session.start({
      surface: 'terminal',
      isInteractive: true,
      cwd: '/w'
    })
    await clock.settle()
    await $.turn.complete(TURN)
    await clock.settle()
    const ui = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      ...BAND
    })
    expect(await ui.find({ type: 'Text', text: /3 scouts out/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ herald arrived$/ })).toBeDefined()
    await ui.unmount()
  })

  test(
    'with the game off a status reaches the engine untouched and no strip draws',
    ALL,
    async ($, on) => {
      const statuses: Status[] = []
      const clock = mock.clock(on)
      engine(on, { ORCA_GAME_MODE: 'off' }, statuses)
      await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/w'
      })
      await clock.settle()
      expect(statuses).toContainEqual({
        text: '3 scouts out',
        origin: 'scout'
      })
      const ui = await $.ui.mount({
        plugin: 'orca-game',
        surface: 'terminal',
        ...BAND
      })
      expect(await ui.find({ type: 'Text', text: /jev · 2 agentes/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^ scout $/ })).toBeUndefined()
      await ui.unmount()
    }
  )

  test(
    'an advisor value of another shape draws no Jev row and breaks nothing',
    ALL,
    async ($, on) => {
      const statuses: Status[] = []
      const clock = mock.clock(on)
      const bad = JSON.stringify({ ...ADVISOR, version: 2 })
      engine(on, { TEST_ADVISOR: bad }, statuses)
      await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/w'
      })
      await clock.settle()
      const ui = await $.ui.mount({
        plugin: 'orca-game',
        surface: 'terminal',
        ...BAND
      })
      expect(await ui.find({ type: 'Text', text: /jev · 2 agentes/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /Write the strip/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^ 3 scouts out$/ })).toBeDefined()
      await ui.unmount()
    }
  )

  test('zen draws one line: Jev’s', ALL, async ($, on) => {
    const statuses: Status[] = []
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_MODE: 'zen' }, statuses)
    await $.session.start({
      surface: 'terminal',
      isInteractive: true,
      cwd: '/w'
    })
    await clock.settle()
    const ui = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      ...BAND
    })
    expect(await ui.find({ type: 'Text', text: /^ jev · 2 agentes$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Write the strip/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /3 scouts out/ })).toBeUndefined()
    await ui.unmount()
  })

  test('zen without Jev draws the latest status alone', ALL, async ($, on) => {
    const statuses: Status[] = []
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_MODE: 'zen', TEST_ADVISOR: '' }, statuses)
    await $.session.start({
      surface: 'terminal',
      isInteractive: true,
      cwd: '/w'
    })
    await clock.settle()
    await $.turn.complete(TURN)
    await clock.settle()
    const ui = await $.ui.mount({
      plugin: 'orca-game',
      surface: 'terminal',
      ...BAND
    })
    expect(await ui.find({ type: 'Text', text: /^ herald arrived$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 scouts out/ })).toBeUndefined()
    await ui.unmount()
  })

  test(
    'a band drawn beneath the game keeps its words in the scene palette, and as drawn with the game off',
    ALL,
    async ($, on) => {
      const statuses: Status[] = []
      const clock = mock.clock(on)
      engine(on, {}, statuses)
      await $.session.start({
        surface: 'terminal',
        isInteractive: true,
        cwd: '/w'
      })
      await clock.settle()
      const ui = await $.ui.mount({
        plugin: 'orca-game',
        surface: 'terminal',
        ...BAND
      })
      const absorbed = await ui.find({ type: 'Text', text: /^scout band$/ })
      expect(absorbed?.props.color).toBe(QUEST_SCENE.band.parchment)
      expect(absorbed?.props.backgroundColor).toBe(QUEST_SCENE.band.panel)
      await ui.unmount()
      await $.command.run({ command: 'quest', args: 'off' } as never)
      const plain = await $.ui.mount({
        plugin: 'orca-game',
        surface: 'terminal',
        ...BAND
      })
      const drawn = await plain.find({ type: 'Text', text: /^scout band$/ })
      expect(drawn).toBeDefined()
      expect(drawn?.props.color).toBeUndefined()
      await plain.unmount()
    }
  )
  test(
    'a new session drops the lines left by a plugin that never cleared them',
    ALL,
    async ($, on) => {
      const clock = mock.clock(on)
      engine(on, {}, [])
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      await $.turn.complete(TURN)
      await clock.settle()
      const drawn = async (text: RegExp) => {
        const ui = await $.ui.mount({ plugin: 'orca-game', surface: 'terminal', ...BAND })
        const found = await ui.find({ type: 'Text', text })
        await ui.unmount()
        return found !== undefined
      }
      expect(await drawn(/^ herald arrived$/)).toBe(true)
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      expect(await drawn(/^ herald arrived$/)).toBe(false)
      expect(await drawn(/^ 3 scouts out$/)).toBe(true)
    }
  )

  test('it publishes whether it absorbs other plugins, and follows /quest', ALL, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, {}, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    const absorbing = async () =>
      (await $.command.run({ command: 'absorbing', args: '' } as never)).text
    expect(await absorbing()).toBe('true')
    await $.command.run({ command: 'quest', args: 'off' } as never)
    await clock.settle()
    expect(await absorbing()).toBe('false')
    await $.command.run({ command: 'quest', args: 'zen' } as never)
    await clock.settle()
    expect(await absorbing()).toBe('true')
  })

  test('a pane launched with its HUD off publishes that it absorbs nothing', ALL, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { ORCA_GAME_HUD: '0' }, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect((await $.command.run({ command: 'absorbing', args: '' } as never)).text).toBe('false')
  })
})
