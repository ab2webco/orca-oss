import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'
import { mockFederatedAgentReady } from './orchestration-federation-worker-runtime-mocks'

// Why: a federated worker terminal is created from an agent id. Passing that id
// as a shell command launched Cursor's desktop app instead of `cursor-agent`
// (issue #11926), so the remote path must resolve through the TUI agent config
// exactly like the local one.
describe('federated worker agent launch', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    vi.restoreAllMocks()
  })

  it('creates an exact folder worker terminal from the agent id, never as a command', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'folder:remote-workspace'
    } as never)
    const createTerminal = vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'term_remote_worker',
      worktreeId: 'folder:remote-workspace',
      title: 'worker'
    })
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_remote_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    // Why: without a stable pane the handler bails at agent_readiness, so the
    // assertions below would pass against a worker that never actually started.
    mockFederatedAgentReady(runtime)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue('tab_remote:leaf_remote')
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue(
      'runtime_test:term_remote_worker:1'
    )
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_remote_worker',
      accepted: true,
      bytesWritten: 1
    })
    const method = ORCHESTRATION_METHODS.find(
      (candidate) => candidate.name === 'orchestration.federationAttachStart'
    )
    if (!method) {
      throw new Error('federationAttachStart method is not registered')
    }

    const result = (await method.handler(
      method.params!.parse({
        dispatchId: 'ctx_remote',
        taskId: 'task_remote',
        taskSpec: 'remote cursor worker',
        protocolVersion: 3,
        worktree: 'folder:remote-workspace',
        agent: 'cursor',
        model: 'gpt-5.3-codex',
        effort: 'high'
      }),
      {
        runtime,
        orchestrationMutation: {
          callerFingerprint: 'home_peer',
          requestId: 'request_remote',
          method: 'orchestration.federationAttachStart',
          payloadHash: 'remote_payload'
        }
      }
    )) as {
      state: string
      failedStage?: string
      lastError?: string
      launch: unknown
    }

    // Why: assert the worker actually reached ready — a spy-only assertion would
    // stay green even if every stage after terminal_create regressed.
    expect(result).toMatchObject({
      state: 'ready',
      launch: {
        requested: { agent: 'cursor', model: 'gpt-5.3-codex', effort: 'high' },
        effective: { agent: 'cursor', model: 'gpt-5.3-codex', effort: 'high' }
      }
    })
    expect(createTerminal).toHaveBeenCalledWith(
      'id:folder:remote-workspace',
      expect.objectContaining({
        startupAgent: 'cursor',
        launchPreferences: { model: 'gpt-5.3-codex', effort: 'high' }
      })
    )
    expect(createTerminal).toHaveBeenCalledWith(
      'id:folder:remote-workspace',
      expect.not.objectContaining({ command: expect.anything() })
    )
  })

  it.each([
    ['the bypass dialog (ORCA-855)', 'claude-bypass-permissions-prompt', "choose 'Yes, I accept'"],
    [
      'first-run setup (ORCA-872)',
      'claude-first-run-setup',
      "Launch on one of this host's managed accounts"
    ]
  ] as const)(
    'refuses a remote Claude terminal parked on %s by name, not timeout',
    async (_label, blockedReason, nextStep) => {
      db = new OrchestrationDb(':memory:')
      const runtime = new OrcaRuntimeService()
      runtime.setOrchestrationDb(db)
      vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
      vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
        id: 'repo::/remote/member'
      } as never)
      vi.spyOn(runtime, 'showTerminal').mockResolvedValue({
        handle: 'term_remote_member',
        worktreeId: 'repo::/remote/member'
      } as never)
      vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
      vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
        handle: 'term_remote_member',
        condition: 'tui-idle',
        satisfied: false,
        status: 'running',
        exitCode: null,
        blockedReason
      })
      const sendTerminalAgentPrompt = vi.spyOn(runtime, 'sendTerminalAgentPrompt')
      const method = ORCHESTRATION_METHODS.find(
        (candidate) => candidate.name === 'orchestration.federationAttachStart'
      )
      if (!method) {
        throw new Error('federationAttachStart method is not registered')
      }

      const result = (await method.handler(
        method.params!.parse({
          dispatchId: 'ctx_remote_claude',
          taskId: 'task_remote_claude',
          taskSpec: 'remote claude member',
          protocolVersion: 3,
          worktree: 'repo::/remote/member',
          terminal: 'term_remote_member'
        }),
        {
          runtime,
          orchestrationMutation: {
            callerFingerprint: 'home_peer',
            requestId: 'request_remote_claude',
            method: 'orchestration.federationAttachStart',
            payloadHash: 'remote_claude_payload'
          }
        }
      )) as { state: string; failedStage?: string; lastError?: string }

      expect(result).toMatchObject({ state: 'failed', failedStage: 'agent_readiness' })
      expect(result.lastError).toContain(`Agent startup blocked: ${blockedReason}.`)
      expect(result.lastError).toContain(nextStep)
      expect(sendTerminalAgentPrompt).not.toHaveBeenCalled()
    }
  )
})
