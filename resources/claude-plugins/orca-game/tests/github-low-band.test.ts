// Runs under `claude plugin test`: the lead's band warns while the account's GitHub budget is low.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const bucket = (remaining: number) => ({ limit: 5000, remaining, resetAt: 1, orcaCalls: 3 })

const LEAD_STATE = {
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'main', displayName: 'orca' },
  agents: [],
  review: null,
  workItem: null,
  lead: { autostart: false, cap: 4, label: 'Orca' },
  role: 'lead',
  githubBudget: { graphql: bucket(400), core: bucket(4000), top: [], low: true }
}

type Drawn = { type?: unknown; props?: { color?: unknown }; children?: unknown }
const isDrawn = (one: unknown): one is Drawn => typeof one === 'object' && one !== null

const shownOf = (one: unknown): string => {
  if (typeof one === 'string') {
    return one
  }
  return isDrawn(one) && Array.isArray(one.children) ? one.children.map(shownOf).join('') : ''
}

const mountBand = async ($: Engine, on: On, state: object) => {
  const clock = mock.clock(on)
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
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(state),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return $.ui.mount({
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
}

describe('lead band with a low GitHub budget', () => {
  test('draws a yellow warning with what is left', async ($, on) => {
    const ui = await mountBand($, on, LEAD_STATE)
    const texts = await ui.findAll({ type: 'Text' })
    const warning = texts.find((one) => shownOf(one) === '! GitHub API low · 400 left')
    expect(isDrawn(warning) ? warning.props?.color : undefined).toBe('yellow')
  })

  test('draws no warning with budget to spare', async ($, on) => {
    const ui = await mountBand($, on, {
      ...LEAD_STATE,
      githubBudget: { graphql: bucket(4000), core: bucket(4000), top: [], low: false }
    })
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some((one) => shownOf(one).includes('GitHub API low'))).toBe(false)
  })
})
