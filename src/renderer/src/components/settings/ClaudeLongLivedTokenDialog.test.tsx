// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render as renderComponent, screen } from '@testing-library/react'
import { i18n } from '../../i18n/i18n'
import { ClaudeLongLivedTokenDialog } from './ClaudeLongLivedTokenDialog'

const FIXTURE_TOKEN = 'fixture-long-lived-token'

function render(
  props: Partial<React.ComponentProps<typeof ClaudeLongLivedTokenDialog>> = {}
): ReturnType<typeof renderComponent> {
  cleanup()
  return renderComponent(
    React.createElement(ClaudeLongLivedTokenDialog, {
      open: true,
      onOpenChange: vi.fn(),
      accountLabel: 'a@example.com',
      hasToken: false,
      submitting: false,
      onSave: vi.fn(),
      onClear: vi.fn(),
      ...props
    })
  )
}

function tokenInput(): HTMLInputElement {
  return screen.getByLabelText('Token') as HTMLInputElement
}

afterEach(cleanup)

describe('ClaudeLongLivedTokenDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('names the account, the command to run and what the token cannot do', () => {
    render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('a@example.com')
    expect(text).toContain('claude setup-token')
    expect(text).toContain('Remote Control')
  })

  it('masks the token and keeps it out of autofill and spellcheck', () => {
    render()
    const input = tokenInput()
    expect(input.type).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })

  it('saves only a non-blank token', () => {
    const onSave = vi.fn()
    render({ onSave })
    const save = screen.getByRole('button', { name: 'Save token' })
    expect(save.hasAttribute('disabled')).toBe(true)

    fireEvent.change(tokenInput(), { target: { value: '   ' } })
    expect(save.hasAttribute('disabled')).toBe(true)

    fireEvent.change(tokenInput(), { target: { value: FIXTURE_TOKEN } })
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith(FIXTURE_TOKEN)
  })

  it('offers removal only when the account already holds a token', () => {
    expect(render().queryByRole('button', { name: 'Remove token' })).toBeNull()

    const onClear = vi.fn()
    render({ hasToken: true, onClear })
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('drops the typed token when the dialog closes', () => {
    const view = render()
    fireEvent.change(tokenInput(), { target: { value: FIXTURE_TOKEN } })
    view.rerender(
      React.createElement(ClaudeLongLivedTokenDialog, {
        open: false,
        onOpenChange: vi.fn(),
        accountLabel: 'a@example.com',
        hasToken: false,
        submitting: false,
        onSave: vi.fn(),
        onClear: vi.fn()
      })
    )
    view.rerender(
      React.createElement(ClaudeLongLivedTokenDialog, {
        open: true,
        onOpenChange: vi.fn(),
        accountLabel: 'a@example.com',
        hasToken: false,
        submitting: false,
        onSave: vi.fn(),
        onClear: vi.fn()
      })
    )
    expect(tokenInput().value).toBe('')
  })
})
