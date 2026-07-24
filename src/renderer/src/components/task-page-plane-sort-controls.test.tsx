// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import { TaskPagePlaneSortControls } from './task-page-plane-sort-controls'

afterEach(cleanup)

function renderControls(
  onSort = vi.fn(),
  orderBy: 'identifier' | 'title' | 'state' | 'priority' | 'assignee' | 'updated' = 'updated',
  direction: 'asc' | 'desc' = 'desc'
): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <TaskPagePlaneSortControls direction={direction} onSort={onSort} orderBy={orderBy} />
    </TooltipProvider>
  )
}

describe('TaskPage Plane sort controls', () => {
  it('exposes the active desktop column and translated direction', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    renderControls(onSort)

    expect(screen.getByRole('button', { name: 'Updated, descending' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Assignee' })).toHaveClass('flex', 'max-lg:!hidden')

    await user.click(screen.getByRole('button', { name: 'ID' }))
    expect(onSort).toHaveBeenCalledWith('identifier')
  })

  it('keeps mobile column and direction controls available below md', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    renderControls(onSort)

    expect(screen.getByTestId('plane-mobile-sort-controls')).toHaveClass('hidden', 'max-md:!flex')
    await user.click(screen.getByRole('combobox', { name: 'Sort by' }))
    await user.click(screen.getByRole('option', { name: 'Priority' }))
    expect(onSort).toHaveBeenCalledWith('priority')

    await user.click(screen.getByRole('button', { name: 'Sort ascending' }))
    expect(onSort).toHaveBeenCalledWith('updated')
  })
})
