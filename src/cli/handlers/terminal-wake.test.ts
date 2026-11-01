import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { parseArgs } from '../args'
import { TERMINAL_WAKE_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import type { RuntimeTerminalWake } from '../../shared/runtime-types'
import { TERMINAL_HANDLERS } from './terminal'

function clientWith(capabilities: string[], wake: RuntimeTerminalWake | Error) {
  return vi.fn(async (method: string) => {
    if (method === 'status.get') {
      return { result: { capabilities } }
    }
    if (method === 'terminal.wake') {
      if (wake instanceof Error) {
        throw wake
      }
      return { result: { wake } }
    }
    throw new Error(`unexpected ${method}`)
  })
}

async function runWake(call: ReturnType<typeof clientWith>, argv: string[]): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const parsed = parseArgs(['terminal', 'wake', ...argv])
  await TERMINAL_HANDLERS['terminal wake']({
    flags: parsed.flags,
    client: { call } as unknown as RuntimeClient,
    cwd: '/tmp/worktree',
    json: false
  })
  return log.mock.calls.map((args) => String(args[0])).join('\n')
}

describe('terminal wake CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wakes the named terminal and prints the handle it now runs under', async () => {
    const call = clientWith([TERMINAL_WAKE_RUNTIME_CAPABILITY], {
      handle: 'term_new',
      status: 'woken',
      paneKey: 'tab:leaf'
    })
    const out = await runWake(call, ['--terminal', 'term_asleep'])
    expect(call).toHaveBeenCalledWith('terminal.wake', { terminal: 'term_asleep' })
    expect(out).toContain('term_new')
  })

  it('says so when the terminal already runs', async () => {
    const call = clientWith([TERMINAL_WAKE_RUNTIME_CAPABILITY], {
      handle: 'term_live',
      status: 'awake'
    })
    expect(await runWake(call, ['--terminal', 'term_live'])).toContain('already running')
  })

  it('points at terminal list while the agent is still starting', async () => {
    const call = clientWith([TERMINAL_WAKE_RUNTIME_CAPABILITY], {
      handle: null,
      status: 'waking',
      paneKey: 'tab:leaf'
    })
    expect(await runWake(call, ['--terminal', 'term_asleep'])).toContain('orca terminal list')
  })

  it('refuses an older host as unsupported instead of calling a method it lacks', async () => {
    const call = clientWith([], { handle: 'x', status: 'woken' })
    await expect(runWake(call, ['--terminal', 'term_asleep'])).rejects.toMatchObject({
      code: 'unsupported'
    })
    expect(call).not.toHaveBeenCalledWith('terminal.wake', expect.anything())
  })

  it('explains a host with no window, which cannot wake anything', async () => {
    const call = clientWith(
      [TERMINAL_WAKE_RUNTIME_CAPABILITY],
      new RuntimeClientError('terminal_wake_unavailable', 'terminal_wake_unavailable')
    )
    await expect(runWake(call, ['--terminal', 'term_asleep'])).rejects.toThrow(/window/)
  })

  it('requires an explicit terminal', async () => {
    const call = clientWith([TERMINAL_WAKE_RUNTIME_CAPABILITY], { handle: 'x', status: 'woken' })
    await expect(runWake(call, [])).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
