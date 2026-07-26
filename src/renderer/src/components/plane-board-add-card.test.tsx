// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlaneBoardAddCard } from './plane-board-add-card'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

// Why explicit: this suite renders the same component per case, so a leftover
// tree would make every query ambiguous.
afterEach(() => {
  cleanup()
})

function openComposer(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Add work item' }))
  return screen.getByLabelText('Work item title')
}

describe('PlaneBoardAddCard', () => {
  it('creates the work item typed into the composer', async () => {
    const onCreate = vi.fn(async () => true)
    render(<PlaneBoardAddCard onCreate={onCreate} />)

    const input = openComposer()
    fireEvent.change(input, { target: { value: 'Fix the failover' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Fix the failover'))
  })

  it('trims the title before creating', async () => {
    const onCreate = vi.fn(async () => true)
    render(<PlaneBoardAddCard onCreate={onCreate} />)

    const input = openComposer()
    fireEvent.change(input, { target: { value: '   padded title   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('padded title'))
  })

  it('never creates an empty work item', () => {
    const onCreate = vi.fn(async () => true)
    render(<PlaneBoardAddCard onCreate={onCreate} />)

    const input = openComposer()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('clears the field after a success so the next item can be typed', async () => {
    const onCreate = vi.fn(async () => true)
    render(<PlaneBoardAddCard onCreate={onCreate} />)

    const input = openComposer()
    fireEvent.change(input, { target: { value: 'First item' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Why the composer stays open: filling a column means adding several in a row.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(screen.getByLabelText('Work item title')).toBeTruthy()
  })

  it('keeps the typed title when creation fails', async () => {
    const onCreate = vi.fn(async () => false)
    render(<PlaneBoardAddCard onCreate={onCreate} />)

    const input = openComposer()
    fireEvent.change(input, { target: { value: 'Survives the error' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Why: the typed title is the user's work — losing it on an API error would
    // make them write it again.
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect((screen.getByLabelText('Work item title') as HTMLInputElement).value).toBe(
      'Survives the error'
    )
  })

  it('closes without creating on Escape', () => {
    const onCreate = vi.fn(async () => true)
    render(<PlaneBoardAddCard onCreate={onCreate} />)

    const input = openComposer()
    fireEvent.change(input, { target: { value: 'Discarded' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add work item' })).toBeTruthy()
  })
})
