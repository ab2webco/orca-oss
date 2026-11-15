// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render as renderComponent, screen } from '@testing-library/react'
import { i18n } from '../../i18n/i18n'
import { ClaudeTokenAccountDialog } from './ClaudeTokenAccountDialog'

const client = vi.hoisted(() => ({
  beginClaudeSetupToken: vi.fn(),
  beginClaudeSetupTokenForNewAccount: vi.fn(),
  submitClaudeSetupTokenCode: vi.fn(),
  getClaudeSetupTokenStatus: vi.fn(),
  cancelClaudeSetupToken: vi.fn()
}))
vi.mock('@/runtime/runtime-claude-setup-token-client', () => client)

const FIXTURE_TOKEN = 'fixture-long-lived-token'
const ACCOUNTS = { accounts: [{ id: 'new', email: 'Team Max', tokenOnly: true }] }
const addFromLongLivedToken = vi.fn()

type Props = React.ComponentProps<typeof ClaudeTokenAccountDialog>

function render(overrides: Partial<Props> = {}): Props {
  cleanup()
  const props: Props = {
    open: true,
    onOpenChange: vi.fn(),
    settings: null,
    canGenerate: true,
    canPaste: true,
    onAdded: vi.fn(),
    ...overrides
  }
  renderComponent(React.createElement(ClaudeTokenAccountDialog, props))
  return props
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText('Name or email') as HTMLInputElement
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ClaudeTokenAccountDialog (ORCA-1215)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    for (const fn of Object.values(client)) {
      fn.mockReset()
    }
    client.cancelClaudeSetupToken.mockResolvedValue(undefined)
    addFromLongLivedToken.mockReset()
    ;(window as unknown as { api: unknown }).api = {
      claudeAccounts: { addFromLongLivedToken }
    }
  })

  it('says why it asks for a name and what a token-only account cannot do', () => {
    render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('claude setup-token')
    expect(text).toContain('email')
    expect(text).toContain('shared login')
  })

  it('keeps Generate off until the account has a name', () => {
    render()
    const generate = screen.getByRole('button', { name: 'Generate token' }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    fireEvent.change(nameInput(), { target: { value: '  ' } })
    expect(generate.disabled).toBe(true)
    fireEvent.change(nameInput(), { target: { value: 'Team Max' } })
    expect(
      (screen.getByRole('button', { name: 'Generate token' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('generates on the host under the typed name and hands back the new roster', async () => {
    vi.useFakeTimers()
    client.beginClaudeSetupTokenForNewAccount.mockResolvedValue({
      sessionId: 's1',
      url: 'https://claude.com/cai/oauth/authorize?x=1'
    })
    client.submitClaudeSetupTokenCode.mockResolvedValue({ state: 'verifying' })
    client.getClaudeSetupTokenStatus.mockResolvedValue({
      state: 'stored',
      error: null,
      accounts: ACCOUNTS
    })
    const props = render()
    fireEvent.change(nameInput(), { target: { value: ' Team Max ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }))
    await settle()

    expect(client.beginClaudeSetupTokenForNewAccount).toHaveBeenCalledWith(null, 'Team Max')
    expect(client.beginClaudeSetupToken).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('sign in as Team Max')
    fireEvent.change(screen.getByLabelText('2. Paste the code the page shows.'), {
      target: { value: 'code#state' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await settle(1_000)

    expect(props.onAdded).toHaveBeenCalledWith(ACCOUNTS)
  })

  it('says nothing was added when the host refuses the name', async () => {
    client.beginClaudeSetupTokenForNewAccount.mockRejectedValue(
      new Error('a@example.com is already added. Set its token from its row instead.')
    )
    render()
    fireEvent.change(nameInput(), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }))
    await act(async () => {})

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('already added')
    expect(alert).toContain('Nothing was added')
  })

  it('adds from a pasted token on this host, never writing it into the page markup', async () => {
    addFromLongLivedToken.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'claudeAccounts:addFromLongLivedToken': Error: Claude rejected this token."
      )
    )
    addFromLongLivedToken.mockResolvedValueOnce(ACCOUNTS)
    const props = render()
    fireEvent.change(nameInput(), { target: { value: 'Team Max' } })
    fireEvent.click(screen.getByRole('button', { name: 'Paste a token instead' }))
    const token = screen.getByLabelText('Token') as HTMLInputElement
    expect(token.type).toBe('password')
    fireEvent.change(token, { target: { value: FIXTURE_TOKEN } })
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await act(async () => {})

    expect(addFromLongLivedToken).toHaveBeenCalledWith({ label: 'Team Max', token: FIXTURE_TOKEN })
    expect(screen.getByRole('alert').textContent).toMatch(/^Claude rejected this token\./)
    expect(document.body.innerHTML).not.toContain(FIXTURE_TOKEN)
    expect(props.onAdded).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await act(async () => {})
    expect(props.onAdded).toHaveBeenCalledWith(ACCOUNTS)
  })

  it('offers only Generate on a paired host, so no token crosses the wire', () => {
    render({ canPaste: false })
    expect(screen.queryByRole('button', { name: 'Paste a token instead' })).toBeNull()
    expect(screen.queryByLabelText('Token')).toBeNull()
  })

  it('opens the paste form directly when Generate is unavailable', () => {
    render({ canGenerate: false })
    expect(screen.queryByRole('button', { name: 'Generate token' })).toBeNull()
    expect(screen.getByLabelText('Token')).toBeTruthy()
  })
})
