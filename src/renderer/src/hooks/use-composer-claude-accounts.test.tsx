// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useComposerClaudeAccounts } from './use-composer-claude-accounts'

const listAccounts = vi.fn()
const originalApi = window.api

describe('useComposerClaudeAccounts', () => {
  afterEach(() => {
    vi.clearAllMocks()
    window.api = originalApi
  })

  it('does not request accounts when the selected target cannot offer the picker', () => {
    window.api = { claudeAccounts: { list: listAccounts } } as never

    renderHook(() => useComposerClaudeAccounts(false))

    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('loads accounts after the selected target becomes eligible', async () => {
    listAccounts.mockResolvedValue({ accounts: [{ id: 'account-a' }] })
    window.api = { claudeAccounts: { list: listAccounts } } as never
    const hook = renderHook(({ enabled }) => useComposerClaudeAccounts(enabled), {
      initialProps: { enabled: false }
    })

    hook.rerender({ enabled: true })

    await waitFor(() => expect(hook.result.current).toEqual([{ id: 'account-a' }]))
    expect(listAccounts).toHaveBeenCalledTimes(1)
  })
})
