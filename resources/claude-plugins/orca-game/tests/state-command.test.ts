// Runs under `claude plugin test`: /orca-game:state, answered by the mod from a fresh `orca game state`.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const ORCA_CLI = '/opt/orca/bin/orca'
const COMSPEC = 'C:\\Windows\\System32\\cmd.exe'

const STATE = {
  config: { mode: 'on', scene: 'quest', hud: true, rewards: true, render: 'classic' },
  sources: {
    mode: 'default',
    scene: 'default',
    hud: 'default',
    rewards: 'default',
    render: 'default'
  },
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'feat/game', displayName: 'game' },
  agents: [
    {
      paneKey: 'tab-1:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  links: [],
  lead: { autostart: false, cap: 3 },
  role: 'lead'
}

type Run = { argv: string[]; env: Record<string, string> | undefined }
type Answer = { exitCode: number; stdout: string; stderr: string }

const engine = (on: On, env: Record<string, string>, runs: Run[], answer: () => Answer) => {
  mock.env(on, env)
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env })
    return { value: { ...answer(), isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const ok = (): Answer => ({ exitCode: 0, stdout: JSON.stringify(STATE), stderr: '' })

const start = async ($: Engine, on: On, env: Record<string, string>, answer = ok) => {
  const runs: Run[] = []
  const clock = mock.clock(on)
  engine(on, env, runs, answer)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  return runs
}

const state = ($: Engine) => $.command.run({ command: 'orca-game:state', args: '' } as never)

describe('/orca-game:state', () => {
  test('prints the report from a fresh read, with this session overrides, and leaves it to the model', async ($, on) => {
    const runs = await start($, on, { ORCA_GAME_CLI: ORCA_CLI })
    await $.command.run({ command: 'quest', args: 'render hd' } as never)
    const before = runs.length
    const answer = await state($)
    expect(runs.slice(before).map((one) => one.argv)).toEqual([
      [ORCA_CLI, 'game', 'state', '--json']
    ])
    expect(answer.text).toBe(
      [
        'Agent Teams game · game (feat/game)',
        'Mode      on (from default)',
        'Scene     quest (from default)',
        'Render    classic (from default) · this session: hd (/orca-game:render)',
        'HUD on (from default) · rewards on (from default)',
        'Lead      this pane · 0 of 3 slots used, 3 free · no members yet'
      ].join('\n')
    )
    expect(answer.context).toEqual([answer.text])
  })

  test('says plainly when the session is not a game pane, running nothing', async ($, on) => {
    const runs = await start($, on, {})
    const answer = await state($)
    expect(answer.text).toMatch(
      /^This session was not started by Orca's game: ORCA_GAME_CLI is not set/
    )
    expect(runs).toEqual([])
  })

  test('names a failing CLI with its exit code and first error line', async ($, on) => {
    const failing = (): Answer => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Unknown command: game state\nRun orca --help'
    })
    await start($, on, { ORCA_GAME_CLI: ORCA_CLI }, failing)
    expect((await state($)).text).toBe(
      'orca game state failed: exit 1: Unknown command: game state'
    )
  })

  test("runs a Windows batch-file CLI through cmd.exe and speaks the pane's language", async ($, on) => {
    const cli = 'C:/Orca/orca-dev.cmd'
    const runs = await start($, on, {
      ORCA_GAME_CLI: cli,
      ComSpec: COMSPEC,
      ORCA_GAME_LOCALE: 'es'
    })
    const before = runs.length
    const answer = await state($)
    expect(runs.slice(before)).toEqual([
      {
        argv: [COMSPEC, '/d', '/v:off', '/s', '/c', '%ORCA_GAME_CLI_LINE%'],
        env: { ORCA_GAME_CLI_LINE: '"C:\\Orca\\orca-dev.cmd" "game" "state" "--json"' }
      }
    ])
    expect(answer.text).toMatch(
      /^Juego de Agent Teams · game \(feat\/game\)\nModo {10}on \(de default\)/
    )
  })
})
