// Runs under `claude plugin test`: above the prompt the game keeps only Jev's failures, stops and escalations.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const ABOVE_PROMPT = {
  plugin: 'orca-game',
  surface: 'terminal',
  component: 'AbovePrompt',
  viewport: { columns: 124, rows: 40, isFullscreen: true },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 8,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 7 },
    view: {}
  }
} as const

const ci = (id: string, status: 'watching' | 'failure', text: string) => ({
  id,
  sha7: 'abc1234',
  branch: 'feat/x',
  status,
  done: 3,
  total: 5,
  failed: status === 'failure' ? ['lint'] : [],
  running: [],
  text,
  startedAtMs: 1,
  finishedAtMs: null
})

const advisorWith = (notice: { level: 'info' | 'warn' | 'block'; text: string }) => ({
  version: 1,
  locale: 'en',
  line: 'jev · 2 agents',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  effort: 'high',
  subagents: [],
  ci: [ci('c1', 'watching', 'CI def5678 3/5'), ci('c2', 'failure', 'CI abc1234 failed: lint')],
  notices: [{ id: 'n1', ...notice, at: 1 }]
})

// Inline plugins close over nothing of this file, so they read what to do from the env.
const JEV: Plugin = {
  name: 'orca-jev-mod-skills',
  register(on) {
    on('session.start', async ($, e, next) => {
      const raw = await $.env.get('TEST_ADVISOR')
      if (raw) {
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
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: ['scout band'] })
    })
  }
}

type Status = { text: string | undefined; origin: string }

const start = async (
  $: Parameters<Parameters<typeof test>[2]>[0],
  on: On,
  env: Record<string, string>,
  statuses: Status[] = []
) => {
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_MODE: 'on', ORCA_GAME_HUD: '1', ...env })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
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
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return $.ui.mount(ABOVE_PROMPT)
}

describe('the text layer above the prompt', () => {
  test(
    'draws a failed CI and a stop in red, and none of Jev’s other lines',
    { plugins: [JEV] },
    async ($, on) => {
      const advisor = advisorWith({ level: 'block', text: 'Stopped: git push --force' })
      const ui = await start($, on, { TEST_ADVISOR: JSON.stringify(advisor) })
      const failed = await ui.find({ type: 'Text', text: 'Jev · CI abc1234 failed: lint' })
      const stopped = await ui.find({ type: 'Text', text: /^Jev · ✖ Stopped: git push --force$/ })
      expect(failed?.props.color).toBe('red')
      expect(stopped?.props.color).toBe('red')
      for (const quiet of [/jev · 2 agents/, /Opus 5\.5/, /CI def5678/]) {
        expect(await ui.find({ type: 'Text', text: quiet })).toBeUndefined()
      }
      await ui.unmount()
    }
  )

  test('draws an escalation in yellow', { plugins: [JEV] }, async ($, on) => {
    const warned = await start($, on, {
      TEST_ADVISOR: JSON.stringify(advisorWith({ level: 'warn', text: 'Run /clear soon' }))
    })
    expect((await warned.find({ type: 'Text', text: /Run \/clear soon/ }))?.props.color).toBe(
      'yellow'
    )
    await warned.unmount()
  })

  test('leaves out an info notice', { plugins: [JEV] }, async ($, on) => {
    const ui = await start($, on, {
      TEST_ADVISOR: JSON.stringify(advisorWith({ level: 'info', text: 'Model lowered' }))
    })
    expect(await ui.find({ type: 'Text', text: /Model lowered/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /CI abc1234 failed/ })).toBeDefined()
    await ui.unmount()
  })

  test('draws nothing of Jev with the game off', { plugins: [JEV] }, async ($, on) => {
    const advisor = advisorWith({ level: 'block', text: 'Stopped' })
    const ui = await start($, on, { ORCA_GAME_MODE: 'off', TEST_ADVISOR: JSON.stringify(advisor) })
    expect(await ui.find({ type: 'Text', text: /^Jev · / })).toBeUndefined()
    await ui.unmount()
  })

  // Why: the strip that held other plugins' lines went with the band (ORCA-1055).
  test('another plugin keeps its status and its own band', { plugins: [SCOUT] }, async ($, on) => {
    const statuses: Status[] = []
    const ui = await start($, on, {}, statuses)
    expect(statuses).toContainEqual({ text: '3 scouts out', origin: 'scout' })
    expect(await ui.find({ type: 'Text', text: 'scout band' })).toBeDefined()
    await ui.unmount()
  })
})
