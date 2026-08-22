// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { AgentSessionLogPaneReading } from '../../../../shared/agent-session-log-state'
import {
  useAgentSessionLogReadings,
  type AgentSessionLogReadPanes
} from './use-agent-session-log-readings'
import { resolveAgentDashboardView } from './agent-dashboard-view'

function reading(paneKey: string): AgentSessionLogPaneReading {
  return {
    paneKey,
    agent: 'claude',
    sessionId: 's1',
    session: { read: false, reason: 'session-log-missing' }
  }
}

function Probe({
  paneKeys,
  readPanes
}: {
  paneKeys: string[]
  readPanes: AgentSessionLogReadPanes
}): React.JSX.Element {
  const readings = useAgentSessionLogReadings(paneKeys, { readPanes, intervalMs: 1_000 })
  return <span data-testid="count">{readings.size}</span>
}

describe('useAgentSessionLogReadings', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reads immediately even when the window was never shown', async () => {
    // The E2E window is never made visible; a visibility or paint gate here
    // would leave the grid permanently empty there.
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const readPanes = vi.fn(async () => [reading('p1')])
    const view = render(<Probe paneKeys={['p1']} readPanes={readPanes} />)
    await act(async () => {})
    expect(readPanes).toHaveBeenCalledTimes(1)
    expect(view.getByTestId('count').textContent).toBe('1')
  })

  it('re-reads on the interval', async () => {
    vi.useFakeTimers()
    const readPanes = vi.fn(async () => [reading('p1')])
    render(<Probe paneKeys={['p1']} readPanes={readPanes} />)
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(2_100)
    })
    expect(readPanes.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('does not call the reader at all with no panes on screen', async () => {
    const readPanes = vi.fn(async () => [])
    render(<Probe paneKeys={[]} readPanes={readPanes} />)
    await act(async () => {})
    expect(readPanes).not.toHaveBeenCalled()
  })

  it('keeps the last readings when a read rejects', async () => {
    const readPanes = vi
      .fn<AgentSessionLogReadPanes>()
      .mockResolvedValueOnce([reading('p1')])
      .mockRejectedValue(new Error('ipc gone'))
    vi.useFakeTimers()
    const view = render(<Probe paneKeys={['p1']} readPanes={readPanes} />)
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(1_100)
    })
    expect(view.getByTestId('count').textContent).toBe('1')
  })
})

describe('resolveAgentDashboardView', () => {
  it('accepts the three real views', () => {
    expect(resolveAgentDashboardView('grid', 'board')).toBe('grid')
    expect(resolveAgentDashboardView('board', 'grid')).toBe('board')
    expect(resolveAgentDashboardView('map', 'grid')).toBe('map')
  })

  it('keeps the historical rings alias pointing at the map', () => {
    expect(resolveAgentDashboardView('rings', 'grid')).toBe('map')
  })

  it('falls back for anything it does not recognise', () => {
    expect(resolveAgentDashboardView('kanban', 'grid')).toBe('grid')
    expect(resolveAgentDashboardView(null, 'grid')).toBe('grid')
  })
})
