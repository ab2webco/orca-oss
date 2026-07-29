import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { RuntimeClientError } from '../runtime-client'
import { parseArgs, validateCommandAndFlags } from '../args'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'
import { TERMINAL_HANDLERS } from './terminal'

const PANE_IDENTITY_ENV = [
  'ORCA_TERMINAL_HANDLE',
  'ORCA_PANE_KEY',
  'ORCA_DEV_CLI_INVOCATION',
  'ORCA_USER_DATA_PATH'
] as const

describe('terminal create --task CLI', () => {
  const savedEnv = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of PANE_IDENTITY_ENV) {
      savedEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of PANE_IDENTITY_ENV) {
      const value = savedEnv.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    vi.restoreAllMocks()
  })

  const createdTerminal = {
    handle: 'term-worker',
    worktreeId: 'repo-1::/tmp/worktree',
    title: null
  }

  type RpcOverrides = {
    wait?: { result: { wait: Record<string, unknown> } }
    dispatch?: { result: { dispatch: Record<string, unknown> | null } } | Error
  }

  function mockComposedCalls(overrides: RpcOverrides = {}): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation(async (method: string) => {
      if (method === 'terminal.create') {
        return { result: { terminal: createdTerminal } }
      }
      if (method === 'terminal.wait') {
        return (
          overrides.wait ?? {
            result: {
              wait: {
                handle: 'term-worker',
                condition: 'tui-idle',
                satisfied: true,
                status: 'running',
                exitCode: null
              }
            }
          }
        )
      }
      if (method === 'orchestration.dispatch') {
        if (overrides.dispatch instanceof Error) {
          throw overrides.dispatch
        }
        return (
          overrides.dispatch ?? {
            result: {
              dispatch: { id: 'ctx_1', task_id: 'task_1', status: 'dispatched' },
              injected: true
            }
          }
        )
      }
      throw new Error(`unexpected RPC ${method}`)
    })
  }

  function baseFlags(): Map<string, string | boolean> {
    return new Map<string, string | boolean>([
      ['worktree', 'path:/tmp/worktree'],
      ['agent', 'claude'],
      ['task', 'task_1'],
      ['from', 'term_coord']
    ])
  }

  async function runCreate(
    flags: Map<string, string | boolean>,
    call: ReturnType<typeof vi.fn>
  ): Promise<void> {
    await TERMINAL_HANDLERS['terminal create']({
      flags,
      client: { call, isRemote: false } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    } as never)
  }

  it('waits for the agent and dispatches the task onto the created terminal', async () => {
    const call = mockComposedCalls()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCreate(baseFlags(), call)

    expect(call.mock.calls.map((entry) => entry[0])).toEqual([
      'terminal.create',
      'terminal.wait',
      'orchestration.dispatch'
    ])
    expect(call).toHaveBeenCalledWith(
      'terminal.wait',
      { terminal: 'term-worker', for: 'tui-idle', timeoutMs: 60_000 },
      { timeoutMs: 65_000 }
    )
    expect(call).toHaveBeenCalledWith('orchestration.dispatch', {
      task: 'task_1',
      to: 'term-worker',
      from: 'term_coord',
      inject: true,
      devMode: false
    })
  })

  it('reports the terminal and the dispatch receipt in one result', async () => {
    const call = mockComposedCalls()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCreate(baseFlags(), call)

    const payload = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      result: { terminal: { handle: string }; dispatch: Record<string, unknown> }
    }
    expect(payload.result.terminal.handle).toBe('term-worker')
    expect(payload.result.dispatch).toEqual({
      id: 'ctx_1',
      task_id: 'task_1',
      status: 'dispatched'
    })
  })

  it('applies --timeout-ms to the agent readiness wait', async () => {
    const call = mockComposedCalls()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const flags = baseFlags()
    flags.set('timeout-ms', '90000')

    await runCreate(flags, call)

    expect(call).toHaveBeenCalledWith(
      'terminal.wait',
      { terminal: 'term-worker', for: 'tui-idle', timeoutMs: 90_000 },
      { timeoutMs: 95_000 }
    )
  })

  it('rejects --task without --agent before any RPC', async () => {
    const call = mockComposedCalls()
    const flags = baseFlags()
    flags.delete('agent')

    await expect(runCreate(flags, call)).rejects.toThrow('--task requires --agent')
    expect(call).not.toHaveBeenCalled()
  })

  it('names the recovery dispatch command when the agent never becomes idle', async () => {
    const call = mockComposedCalls({
      wait: {
        result: {
          wait: {
            handle: 'term-worker',
            condition: 'tui-idle',
            satisfied: false,
            status: 'running',
            exitCode: null,
            blockedReason: 'codex-update-prompt'
          }
        }
      }
    })

    const error: unknown = await runCreate(baseFlags(), call).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RuntimeClientError)
    expect((error as RuntimeClientError).message).toContain('codex-update-prompt')
    expect((error as RuntimeClientError).message).toContain(
      'orca orchestration dispatch --task task_1 --to term-worker --inject'
    )
    expect(call.mock.calls.map((entry) => entry[0])).not.toContain('orchestration.dispatch')
  })

  it('preserves the dispatch failure code and points at the created terminal', async () => {
    const call = mockComposedCalls({
      dispatch: new RuntimeClientError('task_not_found', 'Task task_1 not found.')
    })

    const error: unknown = await runCreate(baseFlags(), call).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RuntimeClientError)
    expect((error as RuntimeClientError).code).toBe('task_not_found')
    expect((error as RuntimeClientError).message).toContain('Task task_1 not found.')
    expect((error as RuntimeClientError).message).toContain(
      'orca orchestration dispatch --task task_1 --to term-worker --inject'
    )
  })

  it('accepts the --task attach flags in the command spec', () => {
    const parsed = parseArgs([
      'terminal',
      'create',
      '--worktree',
      'path:/tmp/worktree',
      '--agent',
      'claude',
      '--task',
      'task_1',
      '--from',
      'term_coord',
      '--timeout-ms',
      '90000'
    ])

    expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
    expect(parsed.flags.get('task')).toBe('task_1')
    expect(parsed.flags.get('from')).toBe('term_coord')
    expect(parsed.flags.get('timeout-ms')).toBe('90000')
  })

  it('documents the --task attach contract in help', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'create'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('[--task <task_id>]')
    expect(help).toContain('worker_done')
  })
})
