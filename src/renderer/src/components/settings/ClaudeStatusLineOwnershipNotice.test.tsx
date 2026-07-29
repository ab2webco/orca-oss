// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeStatusLineOwnership,
  ClaudeStatusLineReplaceResult
} from '../../../../shared/agent-hook-types'
import {
  getClaudeStatusLineOwnershipAction,
  getClaudeStatusLineOwnershipConfirmLabel,
  getClaudeStatusLineOwnershipTitle,
  getClaudeStatusLineOwnershipVaultLocationLabel
} from './claude-statusline-items-copy'
import { ClaudeStatusLineOwnershipNotice } from './ClaudeStatusLineOwnershipNotice'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, params?: Record<string, string>) =>
    params
      ? Object.entries(params).reduce(
          (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
          fallback
        )
      : fallback
}))

const managedOwnership: ClaudeStatusLineOwnership = {
  universes: [{ universe: 'home', accountId: null, accountEmail: null, state: 'managed' }],
  userOwnedHome: false,
  userOwnedVaultCount: 0
}

const userOwnedOwnership: ClaudeStatusLineOwnership = {
  universes: [
    { universe: 'home', accountId: null, accountEmail: null, state: 'user' },
    { universe: 'vault', accountId: 'a1', accountEmail: 'alex@acme.dev', state: 'user' },
    { universe: 'vault', accountId: 'a2', accountEmail: 'sam@acme.dev', state: 'managed' }
  ],
  userOwnedHome: true,
  userOwnedVaultCount: 1
}

function stubAgentHooksApi(
  ownership: ClaudeStatusLineOwnership,
  replaceResult?: ClaudeStatusLineReplaceResult
): { replace: ReturnType<typeof vi.fn> } {
  const replace = vi
    .fn()
    .mockResolvedValue(replaceResult ?? { failedCount: 0, ownership: managedOwnership })
  Object.assign(window, {
    api: {
      agentHooks: {
        claudeStatusLineOwnership: vi.fn().mockResolvedValue(ownership),
        claudeStatusLineReplaceUserOwned: replace
      }
    }
  })
  return { replace }
}

afterEach(cleanup)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ClaudeStatusLineOwnershipNotice', () => {
  it('renders nothing while every universe is managed or empty', async () => {
    stubAgentHooksApi(managedOwnership)
    const { container } = render(<ClaudeStatusLineOwnershipNotice />)
    await waitFor(() => {
      expect(window.api.agentHooks.claudeStatusLineOwnership).toHaveBeenCalled()
    })
    expect(container.innerHTML).toBe('')
  })

  it('surfaces user-owned slots and replaces them only after explicit confirmation', async () => {
    const { replace } = stubAgentHooksApi(userOwnedOwnership)
    render(<ClaudeStatusLineOwnershipNotice />)
    const action = await screen.findByRole('button', {
      name: getClaudeStatusLineOwnershipAction()
    })
    expect(screen.getByText(getClaudeStatusLineOwnershipTitle())).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()

    await userEvent.click(action)
    // The confirmation lists exactly the universes consent covers — never the managed vault.
    expect(
      screen.getByText(getClaudeStatusLineOwnershipVaultLocationLabel('alex@acme.dev'))
    ).toBeTruthy()
    expect(
      screen.queryByText(getClaudeStatusLineOwnershipVaultLocationLabel('sam@acme.dev'))
    ).toBeNull()

    await userEvent.click(
      screen.getByRole('button', { name: getClaudeStatusLineOwnershipConfirmLabel() })
    )
    await waitFor(() => {
      expect(replace).toHaveBeenCalledTimes(1)
    })
    // A clean replacement result clears the notice entirely.
    await waitFor(() => {
      expect(screen.queryByText(getClaudeStatusLineOwnershipTitle())).toBeNull()
    })
  })
})
