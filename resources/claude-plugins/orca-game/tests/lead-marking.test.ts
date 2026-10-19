// Runs under `claude plugin test`: which sessions count as the project's lead.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const STATE = {
  config: { mode: 'on', scene: 'quest', hud: true, rewards: true, render: 'classic' },
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'main', displayName: 'main' },
  agents: [],
  review: null,
  workItem: null,
  links: [],
  lead: { autostart: true, cap: 3 },
  role: 'lead'
}

const start = async (
  $: Engine,
  on: On,
  args: { state: Record<string, unknown>; leadOutput?: string }
) => {
  const store = new Map<string, unknown>()
  const commands: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', ($s, e) => ({ value: store.get(String(Reflect.get(e, 'key'))) }) as never)
  on('store.set', ($s, e) => {
    store.set(String(Reflect.get(e, 'key')), Reflect.get(e, 'value'))
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('command.run', ($s, e) => {
    commands.push(e.command)
    return { text: '' } as never
  })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(args.state),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false
    }
  }))
  on(
    'tool.call',
    () =>
      ({
        result: { stdout: args.leadOutput ?? '', stderr: '' },
        text: args.leadOutput ?? ''
      }) as never
  )
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { store, commands, clock }
}

const STARTED = 'lead-started-sessions'
const runGameLead = ($: Engine) =>
  $.tool.call({ tool: 'Bash', command: '"$ORCA_GAME_CLI" game lead' } as never)

describe('lead marking', () => {
  test('counts a session as the lead once game lead printed it the rules', async ($, on) => {
    const { store } = await start($, on, {
      state: { ...STATE, lead: { autostart: false, cap: 3 } },
      leadOutput: 'You are the lead of cineco.'
    })
    await runGameLead($)
    expect(store.get(STARTED)).toEqual(['s1'])
  })

  test('does not count a session told the lead lives in another pane', async ($, on) => {
    const { store } = await start($, on, {
      state: { ...STATE, lead: { autostart: false, cap: 3 } },
      leadOutput:
        "Not the lead: cineco's lead is live in another pane (term_a), and Orca focused it."
    })
    store.set(STARTED, ['s1'])
    await runGameLead($)
    expect(store.get(STARTED)).toEqual([])
  })

  test('starts the lead skill only while no other pane leads the project', async ($, on) => {
    const free = await start($, on, { state: STATE })
    expect(free.commands).toContain('orca-game:lead')
  })

  test('does not start a second lead while the project lead is live elsewhere', async ($, on) => {
    const taken = await start($, on, {
      state: { ...STATE, leadElsewhere: { handle: 'term_a' } }
    })
    expect(taken.commands).not.toContain('orca-game:lead')
    expect(taken.store.get(STARTED)).toBeUndefined()
  })
})
