import { describe, expect, it, vi } from 'vitest'

const finishAutomationWorkspaceProvenanceRequest = vi.fn()
const releaseAutomationWorkspaceProvenanceRequest = vi.fn()

vi.mock('./workspace-provenance', () => ({
  finishAutomationWorkspaceProvenanceRequest,
  releaseAutomationWorkspaceProvenanceRequest
}))

const { settleAutomationWorkspaceProvenanceRequestOnFailure } =
  await import('./settle-workspace-provenance-on-failure')
const { createStartupAgentRefusedError } = await import('../runtime/startup-agent-refused-error')

const REQUEST = {
  automationId: 'automation-1',
  automationRunId: 'run-1',
  dispatchToken: 'token-1',
  createRequestId: 'reservation-1'
}

describe('settleAutomationWorkspaceProvenanceRequestOnFailure', () => {
  it('consumes the token when the workspace exists but its agent was refused', () => {
    finishAutomationWorkspaceProvenanceRequest.mockClear()
    releaseAutomationWorkspaceProvenanceRequest.mockClear()

    settleAutomationWorkspaceProvenanceRequestOnFailure(
      REQUEST,
      createStartupAgentRefusedError({
        startupAgent: 'claude',
        worktreeId: 'repo-1::/work/a',
        worktreePath: '/work/a',
        failure: new Error('This Claude account is already in use by a global terminal')
      })
    )

    // Why: releasing would let a retry mint a SECOND workspace for the same run.
    expect(finishAutomationWorkspaceProvenanceRequest).toHaveBeenCalledWith(REQUEST)
    expect(releaseAutomationWorkspaceProvenanceRequest).not.toHaveBeenCalled()
  })

  it('keeps a create that produced nothing retryable', () => {
    finishAutomationWorkspaceProvenanceRequest.mockClear()
    releaseAutomationWorkspaceProvenanceRequest.mockClear()

    settleAutomationWorkspaceProvenanceRequestOnFailure(REQUEST, new Error('branch conflict'))

    expect(releaseAutomationWorkspaceProvenanceRequest).toHaveBeenCalledWith(REQUEST)
    expect(finishAutomationWorkspaceProvenanceRequest).not.toHaveBeenCalled()
  })
})
