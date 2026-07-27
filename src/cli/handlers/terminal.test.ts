import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { parseArgs } from '../args'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'
import { TERMINAL_HANDLERS } from './terminal'

describe('terminal close CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the default close RPC unchanged', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { close: { handle: 'term-1', tabId: 'tab-1', ptyKilled: true } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: new Map([['terminal', 'term-1']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.close', { terminal: 'term-1' })
  })

  it('routes --tab to the durable whole-tab RPC', async () => {
    const parsed = parseArgs(['terminal', 'close', '--terminal', 'term-1', '--tab'])
    const call = vi.fn().mockResolvedValue({
      result: {
        close: {
          handle: 'term-1',
          tabId: 'tab-1',
          closeMode: 'tab',
          ptyKilled: false
        }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: parsed.flags,
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(parsed.flags.get('tab')).toBe(true)
    expect(call).toHaveBeenCalledWith('terminal.closeTab', { terminal: 'term-1' })
  })

  it('documents that --tab waits for durable persistence', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'close'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('orca terminal close [--terminal <handle>] [--tab] [--json]')
    expect(help).toContain('durable persistence')
  })
})

describe('terminal create --agent CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createClient(call: ReturnType<typeof vi.fn>): RuntimeClient {
    return { call, isRemote: false } as unknown as RuntimeClient
  }

  function createResultCall(): ReturnType<typeof vi.fn> {
    return vi.fn().mockResolvedValue({
      result: { terminal: { handle: 'term-1', worktreeId: 'repo-1::/tmp/worktree', title: null } }
    })
  }

  async function runCreate(argv: string[], call: ReturnType<typeof vi.fn>): Promise<void> {
    const parsed = parseArgs(argv)
    await TERMINAL_HANDLERS['terminal create']({
      flags: parsed.flags,
      client: createClient(call),
      cwd: '/tmp/worktree',
      json: true
    })
  }

  it('forwards the selected agent so the runtime applies the configured defaults', async () => {
    const call = createResultCall()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCreate(
      [
        'terminal',
        'create',
        '--worktree',
        'path:/tmp/worktree',
        '--title',
        'worker-1',
        '--agent',
        'claude',
        '--json'
      ],
      call
    )

    expect(call).toHaveBeenCalledWith(
      'terminal.create',
      expect.objectContaining({
        worktree: 'path:/tmp/worktree',
        agent: 'claude',
        title: 'worker-1',
        command: undefined,
        rendererBacked: true
      })
    )
  })

  it('rejects --agent together with --command instead of silently dropping one', async () => {
    const call = createResultCall()

    await expect(
      runCreate(
        [
          'terminal',
          'create',
          '--worktree',
          'path:/tmp/worktree',
          '--agent',
          'claude',
          '--command',
          'claude'
        ],
        call
      )
    ).rejects.toThrow('Pass either --agent or --command, not both.')
    expect(call).not.toHaveBeenCalled()
  })

  it('names the valid agents when --agent is unknown', async () => {
    const call = createResultCall()

    await expect(
      runCreate(
        ['terminal', 'create', '--worktree', 'path:/tmp/worktree', '--agent', 'clawed'],
        call
      )
    ).rejects.toThrow(/Unknown TUI agent "clawed"\. Valid agents: .*\bclaude\b.*\bcodex\b/)
    expect(call).not.toHaveBeenCalled()
  })

  it('documents that --command skips the configured agent defaults', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'create'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('[--agent <id>]')
    expect(help).toContain('never applies the configured agent defaults')
    expect(help).toContain('mutually exclusive')
  })
})
