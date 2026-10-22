// Runs under `claude plugin test`: what a lead reads after its conversation is resumed or compacted.
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
  lead: { autostart: false, cap: 3 },
  role: 'lead'
}

const FLEET = [
  'Members: 0 (needs you 0, limited 0, working 0, idle 0, finished 0) · 0/3 running, 3 free',
  'Paused since Orca or the machine restarted: 1 · `orca game resume-members` resumes them, `--discard` frees them',
  'TICKET   STATE    BRANCH       AGENT   ACCOUNT  RESUMES           NAME',
  'CIN-7    working  fab/cin-7    claude  -        its conversation  Daisy'
].join('\n')

const STARTED = 'lead-started-sessions'

const start = async (
  $: Engine,
  on: On,
  args: { state?: Record<string, unknown>; started?: string[]; fleetExit?: number }
) => {
  const store = new Map<string, unknown>([[STARTED, args.started ?? ['s1']]])
  const runs: string[][] = []
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
  on('command.run', () => ({ text: '' }) as never)
  on('classic.SessionStart', () => ({}))
  on('process.run', ($s, e) => {
    const argv = (Reflect.get(e, 'argv') as string[] | undefined) ?? []
    runs.push(argv)
    const isFleet = argv.includes('fleet')
    return {
      value: {
        exitCode: isFleet ? (args.fleetExit ?? 0) : 0,
        stdout: isFleet ? FLEET : JSON.stringify(args.state ?? STATE),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return { runs }
}

const contextOf = (answer: unknown): string =>
  ((Reflect.get(answer as object, 'additionalContext') as string[] | undefined) ?? []).join('\n')

describe('lead brief', () => {
  test('hands a resumed lead its members, paused ones included', async ($, on) => {
    const { runs } = await start($, on, {})
    const context = contextOf(await $.classic.SessionStart({ source: 'resume' }))
    expect(context).toContain('resumed')
    expect(context).toContain('CIN-7    working  fab/cin-7')
    expect(runs.some((argv) => argv.join(' ') === '/opt/orca/bin/orca game fleet')).toBe(true)
  })

  test('after a compaction also points the lead back to its standing rules', async ($, on) => {
    await start($, on, {})
    const context = contextOf(await $.classic.SessionStart({ source: 'compact' }))
    expect(context).toContain('compacted')
    expect(context).toContain('CIN-7')
    expect(context).toContain('game lead')
  })

  test('leaves a fresh start to the lead rules, which print the fleet themselves', async ($, on) => {
    await start($, on, {})
    expect(contextOf(await $.classic.SessionStart({ source: 'startup' }))).toBe('')
  })

  test('says nothing to a session that never ran the lead rules', async ($, on) => {
    await start($, on, { started: [] })
    expect(contextOf(await $.classic.SessionStart({ source: 'resume' }))).toBe('')
  })

  test('says nothing while another pane leads the project', async ($, on) => {
    await start($, on, { state: { ...STATE, leadElsewhere: { handle: 'term_other' } } })
    expect(contextOf(await $.classic.SessionStart({ source: 'resume' }))).toBe('')
  })

  test('says nothing to a member session', async ($, on) => {
    await start($, on, { state: { ...STATE, role: 'member' } })
    expect(contextOf(await $.classic.SessionStart({ source: 'compact' }))).toBe('')
  })

  test('starts the session without a brief when Orca cannot list the fleet', async ($, on) => {
    await start($, on, { fleetExit: 1 })
    expect(contextOf(await $.classic.SessionStart({ source: 'resume' }))).toBe('')
  })
})
