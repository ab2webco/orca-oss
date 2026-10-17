// Runs under `claude plugin test`: the game publishes whether it draws other plugins' lines, live.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const ORCA_CLI = '/opt/orca/bin/orca'
const GAME_STATE = [ORCA_CLI, 'game', 'state', '--json'].join(' ')

// What a plugin like Jev reads: the game's own `absorbing` value.
const READER: Plugin = {
  name: 'reader',
  register(on) {
    on('command.run', { command: 'absorbing' }, async ($) => {
      const read = await $.state.get({ plugin: 'orca-game', key: 'absorbing' })
      return { text: String(read.value) }
    })
  }
}

const stateWith = (config: Record<string, unknown>) =>
  JSON.stringify({
    id: 'x',
    ok: true,
    result: { config, sources: {}, warnings: [], worktree: null, agents: [] }
  })

const engine = (on: On, world: { stdout: string }) => {
  mock.env(on, { ORCA_GAME_CLI: ORCA_CLI })
  on('session.start', ($s, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)
  on('process.run', ($s, e) => {
    const stdout = e.argv.join(' ') === GAME_STATE ? world.stdout : null
    return {
      value: {
        exitCode: stdout === null ? 1 : 0,
        stdout: stdout ?? '',
        stderr: stdout === null ? 'no' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }
  })
}

describe('absorbing', () => {
  test(
    "follows Orca's live config: the HUD turned off, then a mode turned off and back on",
    { plugins: [READER] },
    async ($, on) => {
      const world = { stdout: stateWith({}) }
      const clock = mock.clock(on)
      engine(on, world)
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      await clock.settle()
      const absorbing = async () =>
        (await $.command.run({ command: 'absorbing', args: '' } as never)).text
      expect(await absorbing()).toBe('true')
      world.stdout = stateWith({ hud: false })
      await clock.advance(30000)
      expect(await absorbing()).toBe('false')
      world.stdout = stateWith({ mode: 'off' })
      await clock.advance(30000)
      expect(await absorbing()).toBe('false')
      world.stdout = stateWith({ mode: 'zen' })
      await clock.advance(30000)
      expect(await absorbing()).toBe('true')
    }
  )
})
