// Runs under `claude plugin test`: a member's gh pr create past the project's open-PR cap (ORCA-1301).
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Why no `project`: the runtime never publishes the project's PRs to a member (tracker is off for it).
const memberState = {
  config: { mode: 'on', scene: 'quest', hud: true, rewards: true, render: 'classic' },
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'orca-9', displayName: 'orca-9' },
  agents: [],
  review: null,
  workItem: null,
  links: [],
  lead: { autostart: false, cap: 1 },
  role: 'member'
}

const REFUSAL = 'Orca refused gh pr create: this project has 1 open PRs and its cap is 1.'

const start = async ($: Engine, on: On, capCheck: { exitCode: number; stderr: string }) => {
  const ran: string[] = []
  const checks: string[] = []
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
  on('process.run', ($s, e) => {
    const isCheck = e.argv.slice(1).join(' ') === 'game pr-cap-check'
    if (isCheck) {
      checks.push(e.argv.join(' '))
    }
    return {
      value: {
        ...(isCheck ? capCheck : { exitCode: 0, stderr: '' }),
        stdout: isCheck ? '' : JSON.stringify(memberState),
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  on('tool.call', ($s, e) => {
    ran.push(String(Reflect.get(e, 'command')))
    return { result: { stdout: '', stderr: '' }, text: '' } as never
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { ran, checks }
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)

describe("a member's PR past the project's open-PR cap", () => {
  test("is refused before gh runs when the host's check refuses it", async ($, on) => {
    const { ran, checks } = await start($, on, { exitCode: 3, stderr: `${REFUSAL}\n` })
    const answer: unknown = await bash($, 'gh pr create --fill').catch((error: unknown) => error)
    expect(JSON.stringify(answer)).toContain('its cap is 1')
    expect(checks).toEqual(['/opt/orca/bin/orca game pr-cap-check'])
    expect(ran).toEqual([])
  })

  test('runs when the host passes it or could not check it', async ($, on) => {
    const { ran } = await start($, on, { exitCode: 4, stderr: 'Orca did not check' })
    await bash($, 'gh pr create --fill')
    expect(ran).toEqual(['gh pr create --fill'])
  })

  test('never asks the host for a command that opens no PR', async ($, on) => {
    const { ran, checks } = await start($, on, { exitCode: 3, stderr: REFUSAL })
    await bash($, 'gh pr view 12')
    expect(checks).toEqual([])
    expect(ran).toEqual(['gh pr view 12'])
  })
})
