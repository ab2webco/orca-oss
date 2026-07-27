// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import {
  TaskPagePlaneBoardSkeleton,
  resolvePlaneLoadingSkeleton
} from './task-page-plane-board-skeleton'

afterEach(cleanup)

describe('resolvePlaneLoadingSkeleton', () => {
  it('shows the board-shaped skeleton while the board view loads', () => {
    expect(resolvePlaneLoadingSkeleton({ loading: true, itemCount: 0, viewMode: 'board' })).toBe(
      'board'
    )
  })

  it('keeps the row skeleton for the list view', () => {
    expect(resolvePlaneLoadingSkeleton({ loading: true, itemCount: 0, viewMode: 'list' })).toBe(
      'list'
    )
  })

  it('shows no skeleton once items are present, even mid-refetch', () => {
    // Why: a refetch with cards on screen must not blank the board back to shimmer.
    expect(resolvePlaneLoadingSkeleton({ loading: true, itemCount: 3, viewMode: 'board' })).toBe(
      null
    )
  })

  it('shows no skeleton when nothing is loading', () => {
    expect(resolvePlaneLoadingSkeleton({ loading: false, itemCount: 0, viewMode: 'board' })).toBe(
      null
    )
  })
})

describe('TaskPagePlaneBoardSkeleton', () => {
  it('renders board-width column shells, each filled with card-shaped placeholders', () => {
    const { container } = render(<TaskPagePlaneBoardSkeleton />)

    // w-72 is the real board column width; matching it is the no-jump guarantee.
    const columns = container.querySelectorAll('.w-72')
    expect(columns.length).toBe(5)
    for (const column of columns) {
      expect(column.querySelectorAll('.bg-card').length).toBeGreaterThan(0)
    }
  })
})
