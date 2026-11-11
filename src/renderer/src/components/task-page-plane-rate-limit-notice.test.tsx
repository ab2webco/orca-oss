// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { waitMock } = vi.hoisted(() => ({ waitMock: vi.fn() }))
vi.mock('@/runtime/runtime-plane-rate-limit', () => ({ planeRateLimitWait: waitMock }))

import { TaskPagePlaneRateLimitNotice } from './task-page-plane-rate-limit-notice'

beforeEach(() => {
  vi.useFakeTimers()
  waitMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const settle = () => act(async () => vi.advanceTimersByTimeAsync(0))

// ORCA-1166: the Tasks page showed a bare spinner while Orca's own Plane limiter held its read.
describe('TaskPagePlaneRateLimitNotice', () => {
  it('says the read waits on the rate limit and for how long', async () => {
    waitMock.mockResolvedValue({ reason: 'limit', waitMs: 41_200 })
    render(<TaskPagePlaneRateLimitNotice settings={null} />)
    await settle()
    expect(screen.getByRole('status')).toHaveTextContent('Plane rate limit: waiting 42 s')
    // Why raw text: at 320 px a plain space let the unit wrap alone.
    expect(screen.getByRole('status').textContent).toContain('42\u00a0s')
  })

  it('says a 429 is being retried', async () => {
    waitMock.mockResolvedValue({ reason: 'retry', waitMs: 3_000 })
    render(<TaskPagePlaneRateLimitNotice settings={null} />)
    await settle()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Plane asked to slow down: retrying in 3 s'
    )
  })

  it('shows nothing while nothing waits, and reads again each second', async () => {
    waitMock.mockResolvedValue(null)
    render(<TaskPagePlaneRateLimitNotice settings={null} />)
    await settle()
    expect(screen.queryByRole('status')).toBeNull()
    waitMock.mockResolvedValue({ reason: 'limit', waitMs: 5_000 })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.getByRole('status')).toHaveTextContent('waiting 5 s')
  })
})
