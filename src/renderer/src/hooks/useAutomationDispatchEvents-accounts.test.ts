import { beforeEach, describe, expect, it } from 'vitest'
import {
  makeAutomation,
  mockCreateWorktree,
  registerAndDispatch,
  resetAutomationDispatchHarness
} from './useAutomationDispatchEvents-test-harness'

const CREATE_OPTIONS_ARG = 25
const pins = { claudeAccountId: 'claude-acc', codexAccountId: 'codex-acc' }

describe('useAutomationDispatchEvents account pins', () => {
  beforeEach(resetAutomationDispatchHarness)

  it('pins the Claude account on the worktree a new_per_run Claude run creates', async () => {
    await registerAndDispatch(makeAutomation(pins))

    const options = mockCreateWorktree.mock.calls[0][CREATE_OPTIONS_ARG]
    expect(options).toMatchObject({ claudeAccountId: 'claude-acc' })
    expect(options).not.toHaveProperty('codexAccountId')
  })

  it('pins the Codex account on the worktree a new_per_run Codex run creates', async () => {
    await registerAndDispatch(makeAutomation({ ...pins, agentId: 'codex' }))

    const options = mockCreateWorktree.mock.calls[0][CREATE_OPTIONS_ARG]
    expect(options).toMatchObject({ codexAccountId: 'codex-acc' })
    expect(options).not.toHaveProperty('claudeAccountId')
  })
})
