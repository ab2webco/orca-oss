import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_HANDLERS } from './orchestrator-game'
import type { RuntimeClient } from '../runtime-client'

// ORCA-1110: a Claude pane started without the game mod has no Advisor row and no /orca-game commands.
describe('orca game lead from a pane without the game mod', () => {
  const saved = { ...process.env }
  let output: string[] = []
  let calls: [string, unknown][] = []

  const host = (config: Record<string, unknown> = { mode: 'on' }) =>
    ({
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        return method === 'game.leadRegister'
          ? { ok: true, result: { registered: true } }
          : {
              ok: true,
              result: {
                config,
                agents: [],
                worktree: {
                  id: 'wt1',
                  path: '/Users/me/cineco',
                  branch: 'main',
                  displayName: 'main'
                },
                lead: { autostart: false, cap: 3, agent: 'claude' },
                role: 'lead'
              }
            }
      }
    }) as unknown as RuntimeClient

  const lead = (client: RuntimeClient, json = false) =>
    ORCHESTRATOR_GAME_HANDLERS['game lead']({ flags: new Map(), client, cwd: '/tmp', json })

  beforeEach(() => {
    output = []
    calls = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    // Why: the suite itself may run inside a Claude, WSL, SSH or game pane, which export these.
    for (const name of [
      'CLAUDECODE',
      'ORCA_GAME_MODE',
      'ORCA_GAME_CLI',
      'ORCA_GAME_ROLE',
      'ORCA_CLI_COMMAND',
      'ORCA_RELAY_SOCKET_PATH',
      'ORCA_REMOTE_CLI_BIN_DIR',
      'AI_AGENT'
    ]) {
      delete process.env[name]
    }
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.CLAUDECODE = '1'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it('refuses a local plain Claude pane and says how to start a full lead', async () => {
    await lead(host())

    const text = output.join('\n')
    expect(calls.map(([method]) => method)).toEqual(['game.state'])
    expect(text).toMatch(/^Not the lead: this Claude pane was started without Orca's game mod/)
    expect(text).toContain('no Advisor row')
    expect(text).toContain('Claude Agent Teams')
    expect(text).toContain('/orca-game:lead')
    expect(text).not.toContain('You are the lead of')
  })

  it('names the refusal in JSON with no brief', async () => {
    await lead(host(), true)

    expect(JSON.parse(output.join(''))).toMatchObject({
      result: { role: 'lead', brief: null, outcome: 'plain' }
    })
  })

  it('leads as before in a pane launched with the game mod', async () => {
    process.env.ORCA_GAME_MODE = 'on'
    process.env.ORCA_GAME_CLI = '/opt/Orca/bin/orca'

    await lead(host())

    const text = output.join('\n')
    expect(calls.map(([method]) => method)).toEqual(['game.state', 'game.leadRegister'])
    expect(text).toMatch(/^# You are the lead of cineco/)
    expect(text).toContain('`/opt/Orca/bin/orca game launch <ticket>`')
  })

  it('leads over SSH, where the mod never loads, and says what that pane lacks', async () => {
    process.env.ORCA_RELAY_SOCKET_PATH = '/tmp/orca-relay.sock'

    await lead(host())

    const text = output.join('\n')
    expect(calls.map(([method]) => method)).toEqual(['game.state', 'game.leadRegister'])
    expect(text).toMatch(/^This pane leads without Orca's game mod, which never loads over SSH/)
    expect(text).toContain('You are the lead of cineco')
  })

  it('leads in WSL with the CLI Orca named there, never a bare orca', async () => {
    process.env.ORCA_CLI_COMMAND = 'orca-ide'

    await lead(host())

    const text = output.join('\n')
    expect(text).toMatch(/^This pane leads without Orca's game mod, which never loads in WSL/)
    expect(text).toContain('`orca-ide game launch <ticket>`')
    expect(text).not.toContain('`orca game launch')
  })

  it('leads with the game off for the project and says so', async () => {
    await lead(host({ mode: 'off' }))
    await lead(host({ mode: 'on', show: false }))

    const text = output.join('\n')
    expect(calls.filter(([method]) => method === 'game.leadRegister')).toHaveLength(2)
    expect(text.match(/the game is off for this project/g)).toHaveLength(2)
  })

  it('leads on a Claude Code too old for the mod, instead of sending it to a tab just as plain', async () => {
    process.env.AI_AGENT = 'claude-code_2-1-200_agent'

    await lead(host())

    const text = output.join('\n')
    expect(calls.map(([method]) => method)).toEqual(['game.state', 'game.leadRegister'])
    expect(text).toMatch(
      /^This pane leads without Orca's game mod, because it needs Claude Code 2\.1\.287/
    )
    expect(text).toContain('You are the lead of cineco')
  })

  it('refuses a plain pane on a Claude Code new enough for the mod', async () => {
    process.env.AI_AGENT = 'claude-code_2-1-319_agent'

    await lead(host())

    expect(calls.map(([method]) => method)).toEqual(['game.state'])
    expect(output.join('\n')).toMatch(/^Not the lead: this Claude pane/)
  })

  it('leaves a lead that is not Claude as it was', async () => {
    delete process.env.CLAUDECODE

    await lead(host())

    const text = output.join('\n')
    expect(calls.map(([method]) => method)).toEqual(['game.state', 'game.leadRegister'])
    expect(text).toMatch(/^# You are the lead of cineco/)
  })
})
