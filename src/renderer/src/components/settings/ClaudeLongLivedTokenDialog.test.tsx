// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render as renderComponent, screen } from '@testing-library/react'
import { i18n } from '../../i18n/i18n'
import { ClaudeLongLivedTokenDialog } from './ClaudeLongLivedTokenDialog'

const client = vi.hoisted(() => ({
  beginClaudeSetupToken: vi.fn(),
  submitClaudeSetupTokenCode: vi.fn(),
  getClaudeSetupTokenStatus: vi.fn(),
  cancelClaudeSetupToken: vi.fn()
}))
vi.mock('@/runtime/runtime-claude-setup-token-client', () => client)

const FIXTURE_TOKEN = 'fixture-long-lived-token'
const ACCOUNTS = { accounts: [] }

type Props = React.ComponentProps<typeof ClaudeLongLivedTokenDialog>

function props(overrides: Partial<Props> = {}): Props {
  return {
    open: true,
    onOpenChange: vi.fn(),
    accountId: 'account-1',
    accountLabel: 'a@example.com',
    hasToken: false,
    submitting: false,
    settings: null,
    canGenerate: true,
    canPaste: true,
    onSave: vi.fn(),
    onClear: vi.fn(),
    onGenerated: vi.fn(),
    ...overrides
  }
}

function render(overrides: Partial<Props> = {}): ReturnType<typeof renderComponent> {
  cleanup()
  return renderComponent(React.createElement(ClaudeLongLivedTokenDialog, props(overrides)))
}

function tokenInput(): HTMLInputElement {
  return screen.getByLabelText('Token') as HTMLInputElement
}

function openPaste(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Paste a token instead' }))
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

describe('ClaudeLongLivedTokenDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    for (const fn of Object.values(client)) {
      fn.mockReset()
    }
    client.cancelClaudeSetupToken.mockResolvedValue(undefined)
  })

  it('names the account, the command and what the token cannot do', () => {
    render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('a@example.com')
    expect(text).toContain('claude setup-token')
    expect(text).toContain('Remote Control')
  })

  it('generates on the host: open the link, paste the code, and the host stores the token', async () => {
    vi.useFakeTimers()
    const onGenerated = vi.fn()
    client.beginClaudeSetupToken.mockResolvedValue({ sessionId: 's1', url: 'https://claude.com/x' })
    client.submitClaudeSetupTokenCode.mockResolvedValue({ state: 'verifying' })
    client.getClaudeSetupTokenStatus
      .mockResolvedValueOnce({ state: 'verifying', error: null, accounts: null })
      .mockResolvedValueOnce({ state: 'stored', error: null, accounts: ACCOUNTS })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render({ onGenerated })

    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }))
    await settle()
    expect(client.beginClaudeSetupToken).toHaveBeenCalledWith(null, 'account-1')
    fireEvent.click(screen.getByRole('button', { name: 'Open sign-in page' }))
    expect(open).toHaveBeenCalledWith('https://claude.com/x', '_blank', 'noopener')

    const finish = screen.getByRole('button', { name: 'Finish' })
    expect(finish.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('2. Paste the code the page shows.'), {
      target: { value: ' code#state ' }
    })
    fireEvent.click(finish)
    expect(client.submitClaudeSetupTokenCode).toHaveBeenCalledWith(null, 's1', 'code#state')
    await settle(1_000)
    expect(onGenerated).not.toHaveBeenCalled()
    await settle(1_000)
    expect(onGenerated).toHaveBeenCalledWith(ACCOUNTS)
    open.mockRestore()
  })

  it('shows why generating failed, says nothing changed, and offers a retry', async () => {
    vi.useFakeTimers()
    client.beginClaudeSetupToken.mockResolvedValue({ sessionId: 's1', url: 'https://claude.com/x' })
    client.submitClaudeSetupTokenCode.mockResolvedValue({ state: 'verifying' })
    client.getClaudeSetupTokenStatus.mockResolvedValue({
      state: 'failed',
      error: "That code wasn't accepted.",
      accounts: null
    })
    const onGenerated = vi.fn()
    render({ onGenerated })
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }))
    await settle()
    fireEvent.change(screen.getByLabelText('2. Paste the code the page shows.'), {
      target: { value: 'bogus' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await settle(1_000)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain("That code wasn't accepted.")
    expect(alert.textContent).toContain('keeps its current login and token')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(onGenerated).not.toHaveBeenCalled()
  })

  it('reports a host that could not start the command', async () => {
    client.beginClaudeSetupToken.mockRejectedValue(new Error('Could not start claude setup-token'))
    render()
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not start claude setup-token'
    )
  })

  it('cancels a sign-in still waiting on the host when the dialog closes', async () => {
    client.beginClaudeSetupToken.mockResolvedValue({ sessionId: 's1', url: 'https://claude.com/x' })
    const view = render()
    fireEvent.click(screen.getByRole('button', { name: 'Generate token' }))
    await screen.findByRole('button', { name: 'Open sign-in page' })
    view.rerender(React.createElement(ClaudeLongLivedTokenDialog, props({ open: false })))
    expect(client.cancelClaudeSetupToken).toHaveBeenCalledWith(null, 's1')
  })

  it('offers paste and removal only where the host-only path works', () => {
    render({ canPaste: false, hasToken: true })
    expect(screen.queryByRole('button', { name: 'Paste a token instead' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove token' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Generate token' })).toBeTruthy()
  })

  it('masks a pasted token and keeps it out of autofill and spellcheck', () => {
    render()
    openPaste()
    const input = tokenInput()
    expect(input.type).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })

  it('saves only a non-blank pasted token', () => {
    const onSave = vi.fn()
    render({ onSave })
    openPaste()
    const save = screen.getByRole('button', { name: 'Save token' })
    expect(save.hasAttribute('disabled')).toBe(true)

    fireEvent.change(tokenInput(), { target: { value: '   ' } })
    expect(save.hasAttribute('disabled')).toBe(true)

    fireEvent.change(tokenInput(), { target: { value: FIXTURE_TOKEN } })
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith(FIXTURE_TOKEN)
  })

  it('shows the paste field open when the host cannot generate', () => {
    render({ canGenerate: false })
    expect(tokenInput()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Generate token' })).toBeNull()
  })

  it('offers removal only when the account already holds a token', () => {
    expect(render().queryByRole('button', { name: 'Remove token' })).toBeNull()

    const onClear = vi.fn()
    render({ hasToken: true, onClear })
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('keeps a typed token out of the page markup', () => {
    render()
    openPaste()
    fireEvent.change(tokenInput(), { target: { value: FIXTURE_TOKEN } })
    expect(document.body.innerHTML).not.toContain(FIXTURE_TOKEN)
  })

  it('never offers removal when the token is the account’s only sign-in (ORCA-1215)', () => {
    render({ hasToken: true, tokenOnly: true })
    expect(screen.queryByRole('button', { name: 'Remove token' })).toBeNull()
    expect(document.body.textContent).toContain('only sign-in')
  })

  it('drops the typed token when the dialog closes', () => {
    const view = render()
    openPaste()
    fireEvent.change(tokenInput(), { target: { value: FIXTURE_TOKEN } })
    view.rerender(React.createElement(ClaudeLongLivedTokenDialog, props({ open: false })))
    view.rerender(React.createElement(ClaudeLongLivedTokenDialog, props({ open: true })))
    openPaste()
    expect(tokenInput().value).toBe('')
  })
})
