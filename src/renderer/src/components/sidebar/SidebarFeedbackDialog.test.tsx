// @vitest-environment happy-dom

import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  composeIssue: vi.fn(),
  openUrl: vi.fn(),
  writeClipboardText: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: mocks.toastSuccess,
    warning: mocks.toastWarning
  }
}))

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react')
  const Section = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DialogContent: ReactModule.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & {
        children?: ReactNode
        onOpenAutoFocus?: (event: Event) => void
      }
    >(function DialogContent({ children, onOpenAutoFocus: _onOpenAutoFocus, ...props }, ref) {
      return (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    }),
    DialogDescription: Section,
    DialogFooter: Section,
    DialogHeader: Section,
    DialogTitle: Section
  }
})

import { SidebarFeedbackDialog } from './SidebarFeedbackDialog'

const FORK_ISSUE_URL = 'https://github.com/ab2webco/orca-oss/issues/new?title=Broken&body=Broken'

beforeEach(() => {
  mocks.composeIssue.mockReset()
  mocks.openUrl.mockReset()
  mocks.writeClipboardText.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.toastWarning.mockReset()
  mocks.composeIssue.mockResolvedValue({
    url: FORK_ISSUE_URL,
    body: 'Broken',
    bodyInUrl: true
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      feedback: { composeIssue: mocks.composeIssue },
      shell: { openUrl: mocks.openUrl },
      ui: { writeClipboardText: mocks.writeClipboardText }
    }
  })
})

afterEach(() => {
  cleanup()
})

function typeFeedback(text: string): void {
  fireEvent.change(screen.getByPlaceholderText('What could we improve?'), {
    target: { value: text }
  })
}

describe('SidebarFeedbackDialog', () => {
  it('keeps the dialog scrollable within short windows', () => {
    const { container } = render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    const content = container.querySelector('.scrollbar-sleek')

    expect(content?.className).toContain('max-h-[calc(100vh-3rem)]')
    expect(content?.className).toContain('overflow-y-auto')
  })

  it('opens the prefilled issue in the fork instead of posting anywhere', async () => {
    const onOpenChange = vi.fn()
    render(<SidebarFeedbackDialog open onOpenChange={onOpenChange} />)
    typeFeedback('Broken')

    fireEvent.click(screen.getByRole('button', { name: 'Continue on GitHub' }))

    await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith(FORK_ISSUE_URL))
    expect(mocks.composeIssue).toHaveBeenCalledWith({ feedback: 'Broken' })
    expect(mocks.writeClipboardText).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('copies the report when it is too long to prefill', async () => {
    mocks.composeIssue.mockResolvedValue({
      url: 'https://github.com/ab2webco/orca-oss/issues/new?title=Long',
      body: 'the whole report',
      bodyInUrl: false
    })
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    typeFeedback('a long report')

    fireEvent.click(screen.getByRole('button', { name: 'Continue on GitHub' }))

    await waitFor(() => expect(mocks.writeClipboardText).toHaveBeenCalledWith('the whole report'))
    expect(mocks.openUrl).toHaveBeenCalledWith(
      'https://github.com/ab2webco/orca-oss/issues/new?title=Long'
    )
  })

  it('never opens the composer for an empty report', () => {
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
    typeFeedback('   ')

    const submit = screen.getByRole('button', { name: 'Continue on GitHub' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)

    expect(mocks.composeIssue).not.toHaveBeenCalled()
  })

  it('points every escape hatch at the fork, not upstream', () => {
    render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /GitHub issues/ }))

    expect(mocks.openUrl).toHaveBeenCalledWith('https://github.com/ab2webco/orca-oss/issues/')
  })
})
