// Runs under `claude plugin test`: the mod on Windows, where Orca can hand it a batch-file CLI.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe'
const CHECKS = 'https://github.com/o/r/pull/42/checks?tab=all&x=%20'
const CMD_RUN = [COMSPEC, '/d', '/v:off', '/s', '/c', '%ORCA_GAME_CLI_LINE%']

const STATE = {
  config: { openLinks: 'system' },
  sources: {},
  warnings: [],
  worktree: { id: 'repo-1::C:/w', path: 'C:\\w', branch: 'feat/game', displayName: 'game' },
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
  links: [{ id: 'ci', kind: 'ci', provider: 'github', label: 'CI', url: CHECKS, tone: 'danger' }]
}

type Run = { argv: string[]; env: Record<string, string> | undefined }

const engine = (on: On, cli: string, runs: Run[]) => {
  mock.env(on, { ORCA_GAME_CLI: cli, ComSpec: COMSPEC })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:\\w' }))
  on('session.root', () => ({ value: 'C:\\w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    runs.push({ argv: [...e.argv], env: e.init?.env })
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify(STATE),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

const start = async ($: Engine, on: On, cli: string, runs: Run[]) => {
  const clock = mock.clock(on)
  engine(on, cli, runs)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\w' })
  await clock.settle()
}

const pane = ($: Engine) =>
  $.ui.mount({
    plugin: 'orca-game',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'orca-game-fleet',
    viewport: { columns: 124, rows: 60, isFullscreen: true },
    props: {
      title: 'Fleet',
      isFocused: true,
      bodyColumns: 120,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 50 },
      view: {}
    }
  })

describe('the Orca CLI on Windows', () => {
  test('a .cmd CLI polls game state through cmd.exe with its line in the env', async ($, on) => {
    const runs: Run[] = []
    await start($, on, 'C:/Users/Zoë (dev)/orca-dev.cmd', runs)
    expect(runs[0]).toEqual({
      argv: CMD_RUN,
      env: { ORCA_GAME_CLI_LINE: '"C:\\Users\\Zoë (dev)\\orca-dev.cmd" "game" "state" "--json"' }
    })
  })

  test('openLinks: system asks the .cmd CLI to open the link, the URL kept whole', async ($, on) => {
    const runs: Run[] = []
    await start($, on, 'C:\\Orca\\orca.cmd', runs)
    const ui = await pane($)
    await ui.press({ key: 'open-ci' })
    expect(runs.at(-1)).toEqual({
      argv: CMD_RUN,
      env: {
        ORCA_GAME_CLI_LINE: `"C:\\Orca\\orca.cmd" "game" "open-link" "--url" "${CHECKS}" "--json"`
      }
    })
    await ui.unmount()
  })

  test('an .exe CLI runs by its argv in the native spelling', async ($, on) => {
    const runs: Run[] = []
    await start($, on, 'C:/Program Files/Orca/resources/bin/orca.exe', runs)
    expect(runs[0]).toEqual({
      argv: ['C:\\Program Files\\Orca\\resources\\bin\\orca.exe', 'game', 'state', '--json'],
      env: undefined
    })
  })
})
