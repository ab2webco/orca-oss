// Runs under `claude plugin test`: a member's gh pr create past the project's open-PR cap (ORCA-1301).
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const memberState = (open: number) => ({
  config: { mode: 'on', scene: 'quest', hud: true, rewards: true, render: 'classic' },
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'orca-9', displayName: 'orca-9' },
  agents: [],
  review: null,
  workItem: null,
  links: [],
  lead: { autostart: false, cap: 1 },
  role: 'member',
  project: { reviews: { total: open, url: null, items: [] }, todo: null }
})

const start = async ($: Engine, on: On, open: number) => {
  const ran: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca', ORCA_GAME_ROLE: 'member' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('command.run', () => ({ text: '' }) as never)
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(memberState(open)),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  on('tool.call', ($s, e) => {
    ran.push(String(Reflect.get(e, 'command')))
    return { result: { stdout: '', stderr: '' }, text: '' } as never
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { ran }
}

const createPr = ($: Engine) =>
  $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' } as never)

describe("a member's PR past the project's open-PR cap", () => {
  test('is refused before gh runs once open PRs reach a cap of 1', async ($, on) => {
    const { ran } = await start($, on, 1)
    const answer: unknown = await createPr($).catch((error: unknown) => error)
    expect(JSON.stringify(answer)).toContain('cap of 1')
    expect(ran).toEqual([])
  })

  test('runs under the cap', async ($, on) => {
    const { ran } = await start($, on, 0)
    await createPr($)
    expect(ran).toEqual(['gh pr create --fill'])
  })
})
