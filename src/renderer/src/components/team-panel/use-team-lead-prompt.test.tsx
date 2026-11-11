// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamLeadPrompt } from './use-team-lead-prompt'

const sendRuntimeAgentPrompt = vi.fn()
let panelHandle: string | null = null

vi.mock('@/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ activeWorkspaceExecutionHostId: null })
}))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimeAgentPrompt: (...args: unknown[]) => sendRuntimeAgentPrompt(...args)
}))
vi.mock('@/components/game-inbox/game-owner-questions-client', () => ({
  gameInboxTargetOf: () => ({ kind: 'local' })
}))
vi.mock('./use-team-panel-model', () => ({ useTeamLeadHandle: () => panelHandle }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  sendRuntimeAgentPrompt.mockReset().mockResolvedValue(undefined)
  panelHandle = null
})

describe('useTeamLeadPrompt', () => {
  it('has nothing to send to while the panel has read no lead', () => {
    expect(renderHook(() => useTeamLeadPrompt()).result.current).toBeNull()
  })

  // Why (ORCA-717): the + menu finds the live lead itself, before the panel's next poll.
  it('sends to the lead a caller names, ahead of the one the panel last read', async () => {
    panelHandle = 'term_panel'
    const send = renderHook(() => useTeamLeadPrompt('term_menu')).result.current

    await send?.('add-member:ORCA-9', 'Work on ORCA-9', 'ORCA-9', { quiet: true })

    expect(sendRuntimeAgentPrompt).toHaveBeenCalledWith(
      { kind: 'local' },
      'term_menu',
      'Work on ORCA-9'
    )
  })
})
