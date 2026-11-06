// Runs under `claude plugin test`: a lead's reads carry a hidden My PRs over to the native panel.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { POLL_EVERY_MS } from '../hooks/fleet-sync'

const LAYOUT_KEY = 'panel-layout'
const ORDER = ['team', 'review', 'reviews', 'todo', 'actions', 'metrics']

const HID_REVIEWS = {
  version: 2,
  projects: { 'repo-1': { fleet: { order: ORDER, collapsed: [], shown: ['team'] } } }
}

const stateAs = (role: string) => ({
  config: {},
  sources: {},
  warnings: [],
  worktree: { id: 'repo-1::/w', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [],
  role
})

async function run($: Engine, on: On, role: string, hideExit = 0): Promise<string[][]> {
  const store = new Map<string, unknown>([[LAYOUT_KEY, HID_REVIEWS]])
  const hides: string[][] = []
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_LOCALE: 'en' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', ($s, e) => ({ value: store.get(e.key) }))
  on('store.set', ($s, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    const isHide = e.argv.includes('hide-tab')
    if (isHide) {
      hides.push([...e.argv])
    }
    return {
      value: {
        exitCode: isHide ? hideExit : 0,
        stdout: JSON.stringify(stateAs(role)),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  await clock.advance(POLL_EVERY_MS * 2)
  return hides
}

describe('a Panel that hid My PRs', () => {
  test('a member leaves the project setting to its lead', async ($, on) => {
    expect(await run($, on, 'member')).toEqual([])
  })

  test('a lead hides the PRs tab once across its polls', async ($, on) => {
    expect(await run($, on, 'lead')).toEqual([
      ['/opt/orca/bin/orca', 'game', 'hide-tab', 'prs', '--json']
    ])
  })

  test('an older Orca that refuses is asked once a session, not on every poll', async ($, on) => {
    expect(await run($, on, 'lead', 1)).toHaveLength(1)
  })
})
