// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ClaudeAccountSwitchList } from './ClaudeAccountSwitchList'
import type { ClaudeManagedAccountSummary } from '../../../../shared/types'

// Keep the label pure so the test does not pull the store/toast side effects the
// hook module imports; the label function itself is just endpointLabel || email.
vi.mock('./use-manual-claude-account-switch', () => ({
  claudeAccountSwitchLabel: (account: ClaudeManagedAccountSummary) =>
    account.endpointLabel?.trim() || account.email
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

function account(
  over: Partial<ClaudeManagedAccountSummary> & { id: string }
): ClaudeManagedAccountSummary {
  return {
    email: `${over.id}@example.com`,
    authMethod: 'subscription-oauth',
    managedAuthRuntime: 'host',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...over
  } as ClaudeManagedAccountSummary
}

function renderList(props: Parameters<typeof ClaudeAccountSwitchList>[0]) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ClaudeAccountSwitchList {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function checkedState(name: string): string | null {
  const row = screen.getAllByRole('menuitemradio').find((el) => el.textContent?.includes(name))
  return row?.getAttribute('aria-checked') ?? null
}

afterEach(() => cleanup())

describe('ClaudeAccountSwitchList active-account marker', () => {
  it('marks the active OAuth account and no other', () => {
    renderList({
      oauthAccounts: [account({ id: 'active-1' }), account({ id: 'spare-1' })],
      endpointAccounts: [],
      onSelect: () => {},
      activeAccountId: 'active-1',
      activeModel: 'sonnet'
    })
    expect(checkedState('active-1@example.com')).toBe('true')
    expect(checkedState('spare-1@example.com')).toBe('false')
  })

  it('marks the active custom-endpoint (z.ai) account too', () => {
    renderList({
      oauthAccounts: [account({ id: 'oauth-1' })],
      endpointAccounts: [
        account({ id: 'zai-1', authMethod: 'custom-endpoint', endpointLabel: 'z.ai · GLM' })
      ],
      onSelect: () => {},
      activeAccountId: 'zai-1',
      activeModel: null
    })
    // The endpoint row carries no model suffix, yet must still show the active dot.
    expect(checkedState('z.ai · GLM')).toBe('true')
    expect(checkedState('oauth-1@example.com')).toBe('false')
  })

  it('marks nothing when no account is active', () => {
    renderList({
      oauthAccounts: [account({ id: 'a' }), account({ id: 'b' })],
      endpointAccounts: [],
      onSelect: () => {},
      activeAccountId: null,
      activeModel: null
    })
    expect(
      screen
        .getAllByRole('menuitemradio')
        .every((el) => el.getAttribute('aria-checked') === 'false')
    ).toBe(true)
  })
})
