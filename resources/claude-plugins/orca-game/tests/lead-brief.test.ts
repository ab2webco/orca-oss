// Runs under `claude plugin test`: what a lead reads after its conversation is resumed or compacted.
import { describe, expect, mock } from 'claude-code/testing'
import { test } from './test-budget'
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

// Why one id per test: a session rearms its lead once per process, and every test here is its own session.
let sessions = 0

const start = async (
  $: Engine,
  on: On,
  args: {
    state?: Record<string, unknown>
    started?: string[]
    fleetExit?: number
    /** The lead rules ran after this process started the session, as before a compaction. */
    startedLater?: true
  }
) => {
  const session = `s${++sessions}`
  const started = args.started ?? [session]
  const store = new Map<string, unknown>([[STARTED, args.startedLater ? [] : started]])
  const runs: string[][] = []
  const commands: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { ORCA_GAME_CLI: '/opt/orca/bin/orca' })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: session }))
  on('store.get', ($s, e) => ({ value: store.get(String(Reflect.get(e, 'key'))) }) as never)
  on('store.set', ($s, e) => {
    store.set(String(Reflect.get(e, 'key')), Reflect.get(e, 'value'))
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', ($s, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('command.run', ($s, e) => {
    commands.push(e.command)
    return { text: '' } as never
  })
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
  if (args.startedLater) {
    store.set(STARTED, started)
  }
  return { runs, commands, clock, toasts, store }
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

  test('runs the lead skill again for a resumed lead, so its rules and report watcher come back', async ($, on) => {
    const { commands, clock } = await start($, on, {})
    await $.classic.SessionStart({ source: 'resume' })
    await clock.settle()
    expect(commands).toEqual(['orca-game:lead'])
  })

  test('leaves the lead skill alone after a compaction, which keeps the session running', async ($, on) => {
    const { commands, clock } = await start($, on, { startedLater: true })
    await $.classic.SessionStart({ source: 'compact' })
    await clock.settle()
    expect(commands).toEqual([])
  })

  test('runs no lead skill for a resumed session that is not the lead', async ($, on) => {
    const { commands, clock } = await start($, on, {
      state: { ...STATE, leadElsewhere: { handle: 'term_other' } }
    })
    await $.classic.SessionStart({ source: 'resume' })
    await clock.settle()
    expect(commands).toEqual([])
  })

  test('leaves a fresh start to the lead rules, which print the fleet themselves', async ($, on) => {
    await start($, on, {})
    expect(contextOf(await $.classic.SessionStart({ source: 'startup' }))).toBe('')
  })

  test('says nothing to a session that never ran the lead rules', async ($, on) => {
    await start($, on, { started: [] })
    expect(contextOf(await $.classic.SessionStart({ source: 'resume' }))).toBe('')
  })

  test('tells a resumed former lead that another pane leads, and to stop its watcher (ORCA-728)', async ($, on) => {
    const { runs, toasts, store } = await start($, on, {
      state: { ...STATE, leadElsewhere: { handle: 'term_other' } }
    })
    const context = contextOf(await $.classic.SessionStart({ source: 'resume' }))
    expect(context).toContain('no longer')
    expect(context).toContain('term_other')
    expect(context).toContain('watcher')
    expect(context).not.toContain('CIN-7')
    expect(runs.some((argv) => argv.includes('fleet'))).toBe(false)
    expect(toasts.some((one) => one.includes('term_other'))).toBe(true)
    expect(store.get(STARTED)).toEqual([])
  })

  test('tells a compacted former lead the same', async ($, on) => {
    await start($, on, { state: { ...STATE, leadElsewhere: { handle: 'term_other' } } })
    expect(contextOf(await $.classic.SessionStart({ source: 'compact' }))).toContain('term_other')
  })

  test('says nothing to a member session', async ($, on) => {
    await start($, on, { state: { ...STATE, role: 'member' } })
    expect(contextOf(await $.classic.SessionStart({ source: 'compact' }))).toBe('')
  })

  // ORCA-1175: another plugin can take classic.SessionStart first and never pass it on.
  test('rearms a resumed lead whose SessionStart hook another plugin never passed on', async ($, on) => {
    const { commands, clock } = await start($, on, {})
    await clock.settle()
    expect(commands).toEqual(['orca-game:lead'])
  })

  test('rearms a resumed lead once when its SessionStart hook runs too', async ($, on) => {
    const { commands, clock } = await start($, on, {})
    await $.classic.SessionStart({ source: 'resume' })
    await $.classic.SessionStart({ source: 'resume' })
    await clock.settle()
    expect(commands).toEqual(['orca-game:lead'])
  })

  test('rearms a resumed lead once in a project that autostarts its lead', async ($, on) => {
    const { commands, clock } = await start($, on, {
      state: { ...STATE, lead: { autostart: true, cap: 3 } }
    })
    await clock.settle()
    expect(commands).toEqual(['orca-game:lead'])
  })

  test('rearms no session that another pane now leads, hook or not', async ($, on) => {
    const { commands, clock } = await start($, on, {
      state: { ...STATE, leadElsewhere: { handle: 'term_other' } }
    })
    await clock.settle()
    expect(commands).toEqual([])
  })

  test('rearms no fresh session, which never ran the lead rules', async ($, on) => {
    const { commands, clock } = await start($, on, { started: [] })
    await clock.settle()
    expect(commands).toEqual([])
  })

  test('starts the session without a brief when Orca cannot list the fleet', async ($, on) => {
    await start($, on, { fleetExit: 1 })
    expect(contextOf(await $.classic.SessionStart({ source: 'resume' }))).toBe('')
  })
})
