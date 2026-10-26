import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminalWait } from '../../../../shared/runtime-types'
import { DISPATCH_INPUT_WRITTEN_UNPROVEN } from '../../../../shared/dispatch-delivery-proof'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'

const HANDLE = 'term_remote_worker'

type AttachResult = {
  state: string
  failedStage?: string
  lastError?: string
  effects: { kind: string; state?: string }[]
}

function idleWait(satisfied: boolean, blockedReason?: 'shell-startup-command-withheld') {
  const wait: RuntimeTerminalWait = {
    handle: HANDLE,
    condition: 'tui-idle',
    satisfied,
    status: 'running',
    exitCode: null,
    ...(blockedReason ? { blockedReason } : {})
  }
  return wait
}

function createRemoteRuntime(db: OrchestrationDb): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
  vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
    id: 'folder:remote-workspace'
  } as never)
  vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
    handle: HANDLE,
    worktreeId: 'folder:remote-workspace',
    title: 'worker'
  })
  vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue('tab_remote:leaf_remote')
  vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue('runtime_test:pty:1')
  vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
  vi.spyOn(runtime, 'waitForAgentComposerReady').mockResolvedValue({
    ready: true,
    proven: true,
    state: 'ready',
    signal: null,
    waitedMs: 0
  })
  return runtime
}

async function attach(runtime: OrcaRuntimeService, timeoutMs?: number): Promise<AttachResult> {
  const method = ORCHESTRATION_METHODS.find(
    (candidate) => candidate.name === 'orchestration.federationAttachStart'
  )
  if (!method) {
    throw new Error('federationAttachStart method is not registered')
  }
  return (await method.handler(
    method.params!.parse({
      dispatchId: 'ctx_remote',
      taskId: 'task_remote',
      taskSpec: 'remote worker',
      protocolVersion: 3,
      worktree: 'folder:remote-workspace',
      agent: 'claude',
      ...(timeoutMs ? { timeoutMs } : {})
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
  )) as AttachResult
}

// Why: on a paired host whose zsh took longer than the 1.5 s shell-ready budget,
// the remote start pasted the TASK into zsh and still reported it accepted.
describe('federated worker agent readiness (ORCA-792)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    vi.restoreAllMocks()
  })

  it('refuses to paste into a shell whose launch command was withheld after the wait began', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRemoteRuntime(db)
    let withheld = false
    vi.spyOn(runtime, 'waitForTerminal').mockImplementation(async () => {
      withheld = true
      return idleWait(true)
    })
    vi.spyOn(runtime, 'isTerminalStartupCommandWithheld').mockImplementation(() => withheld)
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(false)
    const send = vi.spyOn(runtime, 'sendTerminalAgentPrompt')

    const result = await attach(runtime)

    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'failed', failedStage: 'agent_readiness' })
    expect(result.lastError).toMatch(/^agent_not_started: .*withheld/)
  })

  it('refuses to paste when a shell, not the agent, owns the pane', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRemoteRuntime(db)
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue(idleWait(true))
    vi.spyOn(runtime, 'isTerminalStartupCommandWithheld').mockReturnValue(false)
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(false)
    const send = vi.spyOn(runtime, 'sendTerminalAgentPrompt')

    const result = await attach(runtime)

    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'failed', failedStage: 'agent_readiness' })
    expect(result.lastError).toMatch(/^agent_not_started: /)
  })

  it('waits for a slow shell to deliver the launch command within the same budget', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRemoteRuntime(db)
    let withheld = true
    setTimeout(() => {
      withheld = false
    }, 50)
    const wait = vi
      .spyOn(runtime, 'waitForTerminal')
      .mockResolvedValueOnce(idleWait(false, 'shell-startup-command-withheld'))
      .mockResolvedValueOnce(idleWait(true))
    vi.spyOn(runtime, 'isTerminalStartupCommandWithheld').mockImplementation(() => withheld)
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
    const send = vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: HANDLE,
      accepted: true,
      bytesWritten: 1
    })

    const result = await attach(runtime, 5_000)

    expect(wait).toHaveBeenCalledTimes(2)
    const secondBudget = wait.mock.calls[1][1]?.timeoutMs ?? 0
    expect(secondBudget).toBeGreaterThan(0)
    expect(secondBudget).toBeLessThan(5_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.state).toBe('ready')
    expect(result.effects).toContainEqual(
      expect.objectContaining({ kind: 'dispatch_input', state: 'accepted' })
    )
  })

  it('fails by name when the launch command is still withheld at the deadline', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRemoteRuntime(db)
    const wait = vi
      .spyOn(runtime, 'waitForTerminal')
      .mockResolvedValue(idleWait(false, 'shell-startup-command-withheld'))
    vi.spyOn(runtime, 'isTerminalStartupCommandWithheld').mockReturnValue(true)
    const send = vi.spyOn(runtime, 'sendTerminalAgentPrompt')

    const result = await attach(runtime, 300)

    expect(wait).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'failed', failedStage: 'agent_readiness' })
    expect(result.lastError).toContain('shell-startup-command-withheld')
  })

  it('reports the input as written but unproven when the composer marker never came', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createRemoteRuntime(db)
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue(idleWait(true))
    vi.spyOn(runtime, 'isTerminalStartupCommandWithheld').mockReturnValue(false)
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
    vi.spyOn(runtime, 'waitForAgentComposerReady').mockResolvedValue({
      ready: true,
      proven: false,
      state: 'unobserved',
      signal: null,
      waitedMs: 0
    })
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: HANDLE,
      accepted: true,
      bytesWritten: 1
    })

    const result = await attach(runtime)

    expect(result.state).toBe('ready')
    expect(result.effects).toContainEqual(
      expect.objectContaining({ kind: 'dispatch_input', state: DISPATCH_INPUT_WRITTEN_UNPROVEN })
    )
  })
})
