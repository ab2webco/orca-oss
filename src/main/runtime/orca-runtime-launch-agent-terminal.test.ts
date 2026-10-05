import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

function createRuntime() {
  const runtime = new OrcaRuntimeService({
    getSettings: () => ({ disabledTuiAgents: [] }),
    getRepo: () => ({ id: 'repo-1', path: '/tmp/repo', connectionId: null })
  } as never)
  const internal = runtime as unknown as {
    resolveWorktreeSelector: ReturnType<typeof vi.fn>
    buildStartupForAgent: ReturnType<typeof vi.fn>
    markLocalWorkspaceTrustedForAgent: ReturnType<typeof vi.fn>
  }
  internal.resolveWorktreeSelector = vi.fn(async () => ({
    id: 'worktree-1',
    repoId: 'repo-1',
    path: '/tmp/worktree-1'
  }))
  internal.buildStartupForAgent = vi.fn(() => ({
    agent: 'claude',
    startup: { command: 'claude', env: {} }
  }))
  internal.markLocalWorkspaceTrustedForAgent = vi.fn()
  return runtime
}

describe('launchAgentTerminal', () => {
  it('forwards launch-scoped accounts to the terminal it creates', async () => {
    const runtime = createRuntime()
    const createTerminal = vi
      .spyOn(runtime, 'createTerminal')
      .mockResolvedValue({ handle: 'term_1', worktreeId: 'worktree-1', title: null })

    await runtime.launchAgentTerminal('id:worktree-1', {
      agent: 'claude',
      prompt: 'run',
      claudeAccountId: 'claude-acc'
    })

    expect(createTerminal).toHaveBeenCalledWith(
      'id:worktree-1',
      expect.objectContaining({ claudeAccountId: 'claude-acc' })
    )
    expect(createTerminal.mock.calls[0]?.[1]).not.toHaveProperty('codexAccountId')
  })
})
