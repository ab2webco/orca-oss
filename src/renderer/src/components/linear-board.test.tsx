// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { LinearBoard } from './linear-board'

afterEach(cleanup)

describe('LinearBoard', () => {
  it('lays groups out as horizontally scrollable fixed-width columns', () => {
    const { container } = render(
      <LinearBoard
        columns={[
          { key: 'status:todo', label: 'Todo', issues: ['ORCA-1'] },
          { key: 'status:done', label: 'Done', issues: ['ORCA-2'] }
        ]}
        dragDisabledReason={null}
        renderCard={(item) => <div key={item}>{item}</div>}
      />
    )

    expect(container.querySelector('[data-linear-board-scroll]')).toHaveClass('overflow-x-auto')
    expect(container.querySelector('[data-linear-board-column]')).toHaveClass('w-72', 'shrink-0')
    expect(container.querySelector('[data-linear-board-column-cards]')).toHaveClass(
      'overflow-y-auto'
    )
  })

  it('keeps non-status groups as columns and explains why dragging is unavailable', () => {
    render(
      <LinearBoard
        columns={[{ key: 'assignee:ada', label: 'Ada', issues: ['ORCA-1'] }]}
        dragDisabledReason="Drag is unavailable while grouping by assignee."
        renderCard={(item) => (
          <div key={item} draggable={false}>
            {item}
          </div>
        )}
      />
    )

    expect(screen.getByRole('note')).toHaveTextContent(
      'Drag is unavailable while grouping by assignee.'
    )
    expect(screen.getByText('ORCA-1')).toHaveAttribute('draggable', 'false')
  })
})

describe('Linear board preference persistence', () => {
  it('defaults to board and persists a valid linear view mode', async () => {
    const { readFileSync } = await import('node:fs')
    const types = readFileSync('src/shared/types.ts', 'utf-8')
    const persistence = readFileSync('src/main/persistence.ts', 'utf-8')
    const taskPage = readFileSync('src/renderer/src/components/TaskPage.tsx', 'utf-8')

    expect(types).toContain('linearViewMode?: LinearViewMode')
    expect(persistence).toContain("return value === 'list' ? 'list' : 'board'")
    expect(persistence).toContain('linearViewMode: normalizeLinearViewMode(')
    expect(taskPage).toContain("settings?.linearViewMode ?? 'board'")
    expect(taskPage).toContain('dragDisabledReason={linearBoardDragDisabledReason}')
    expect(taskPage).toContain('draggable={linearStatusBoardEnabled && !updating}')
    expect(taskPage).toContain('void updateSettings({ linearViewMode: viewMode })')
  })
})
