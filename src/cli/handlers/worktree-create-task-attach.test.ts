import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { RuntimeClientError } from '../runtime-client'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'
import { WORKTREE_HANDLERS } from './worktree'

const PANE_IDENTITY_ENV = [
  'ORCA_TERMINAL_HANDLE',
  'ORCA_PANE_KEY',
  'ORCA_WORKSPACE_ID',
  'ORCA_WORKTREE_ID',
  'ORCA_DEV_CLI_INVOCATION',
  'ORCA_USER_DATA_PATH'
] as const

describe('worktree create --task CLI', () => {
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

  const createdWorktree = {
    id: 'repo-1::/tmp/repo/feature',
    path: '/tmp/repo/feature',
    branch: 'feature'
  }

  type RpcOverrides = {
    create?: { result: Record<string, unknown> }
    dispatch?: { result: { dispatch: Record<string, unknown> | null } } | Error
  }

  function mockComposedCalls(overrides: RpcOverrides = {}): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation(async (method: string) => {
      if (method === 'worktree.create') {
        return (
          overrides.create ?? {
            result: {
              worktree: createdWorktree,
              lineage: null,
              warnings: [],
              agentTerminalHandle: 'term-agent'
            }
          }
        )
      }
      if (method === 'terminal.wait') {
        return {
          result: {
            wait: {
              handle: 'term-agent',
              condition: 'tui-idle',
              satisfied: true,
              status: 'running',
              exitCode: null
            }
          }
        }
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
      ['repo', 'id:repo-1'],
      ['name', 'feature'],
      ['no-parent', true],
      ['agent', 'claude'],
      ['task', 'task_1'],
      ['from', 'term_coord']
    ])
  }

  async function runCreate(
    flags: Map<string, string | boolean>,
    call: ReturnType<typeof vi.fn>
  ): Promise<void> {
    await WORKTREE_HANDLERS['worktree create']({
      flags,
      client: { call, isRemote: false } as unknown as RuntimeClient,
      cwd: '/tmp/repo',
      json: true
    } as never)
  }

  it('attaches the startup agent terminal to the task after readiness', async () => {
    const call = mockComposedCalls()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCreate(baseFlags(), call)

    expect(call.mock.calls.map((entry) => entry[0])).toEqual([
      'worktree.create',
      'terminal.wait',
      'orchestration.dispatch'
    ])
    expect(call).toHaveBeenCalledWith(
      'worktree.create',
      expect.objectContaining({ startupAgent: 'claude', startupPrompt: '' })
    )
    expect(call).toHaveBeenCalledWith(
      'terminal.wait',
      { terminal: 'term-agent', for: 'tui-idle', timeoutMs: 60_000 },
      { timeoutMs: 65_000 }
    )
    expect(call).toHaveBeenCalledWith('orchestration.dispatch', {
      task: 'task_1',
      to: 'term-agent',
      from: 'term_coord',
      inject: true,
      devMode: false
    })
  })

  it('falls back to the startup terminal handle for older runtimes', async () => {
    const call = mockComposedCalls({
      create: {
        result: {
          worktree: createdWorktree,
          lineage: null,
          warnings: [],
          startupTerminal: { spawned: true, handle: 'term-startup' }
        }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCreate(baseFlags(), call)

    expect(call).toHaveBeenCalledWith(
      'terminal.wait',
      { terminal: 'term-startup', for: 'tui-idle', timeoutMs: 60_000 },
      { timeoutMs: 65_000 }
    )
  })

  it('reports the worktree and the dispatch receipt in one result', async () => {
    const call = mockComposedCalls()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCreate(baseFlags(), call)

    const payload = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
      result: { worktree: { id: string }; dispatch: Record<string, unknown> }
    }
    expect(payload.result.worktree.id).toBe('repo-1::/tmp/repo/feature')
    expect(payload.result.dispatch).toEqual({
      id: 'ctx_1',
      task_id: 'task_1',
      status: 'dispatched'
    })
  })

  it('rejects --task without --agent before any RPC', async () => {
    const call = mockComposedCalls()
    const flags = baseFlags()
    flags.delete('agent')

    await expect(runCreate(flags, call)).rejects.toThrow('--task requires --agent')
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects --task together with --prompt before any RPC', async () => {
    const call = mockComposedCalls()
    const flags = baseFlags()
    flags.set('prompt', 'do the thing')

    await expect(runCreate(flags, call)).rejects.toThrow(
      '--task and --prompt are mutually exclusive'
    )
    expect(call).not.toHaveBeenCalled()
  })

  it('surfaces a recovery path when no agent terminal handle is returned', async () => {
    const call = mockComposedCalls({
      create: {
        result: { worktree: createdWorktree, lineage: null, warnings: [] }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const error: unknown = await runCreate(baseFlags(), call).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(RuntimeClientError)
    expect((error as RuntimeClientError).message).toContain('orca terminal list')
    expect((error as RuntimeClientError).message).toContain(
      'orca orchestration dispatch --task task_1'
    )
    expect(call.mock.calls.map((entry) => entry[0])).toEqual(['worktree.create'])
  })

  it('documents the --task attach contract in help', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['worktree', 'create'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('[--task <task_id>]')
    expect(help).toContain('worker_done')
  })
})
