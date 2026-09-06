// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogData } from '../../../shared/update-status-types'
import { useAppStore } from '../store'
import { UpdateCard } from './UpdateCard'

const openUrl = vi.fn()

function renderAvailable(changelog: ChangelogData): RenderResult {
  useAppStore.setState({
    updateStatus: { state: 'available', version: '1.4.200', changelog },
    updateChangelog: changelog,
    dismissedUpdateVersion: null,
    updateCardCollapsed: false,
    updateReassuranceSeen: true
  })
  return render(<UpdateCard />)
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  openUrl.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      shell: { openUrl },
      ui: { set: vi.fn().mockResolvedValue(undefined) },
      updater: {
        check: vi.fn(),
        dismissNudge: vi.fn(),
        dismissAvailableUpdate: vi.fn().mockResolvedValue(undefined),
        download: vi.fn()
      }
    }
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('UpdateCard nudge highlights', () => {
  it('renders the headline and each highlight as its own line, with no empty summary', () => {
    const { container } = renderAvailable({
      release: {
        title: 'Faster terminal start',
        description: '',
        highlights: ['Tabs restore in half the time', 'SSH panes keep their scrollback'],
        releaseNotesUrl: 'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.200'
      },
      releasesBehind: null
    })

    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('Faster terminal start')
    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['Tabs restore in half the time', 'SSH panes keep their scrollback'])
    expect(container.querySelector('p.text-sm.text-muted-foreground')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Read the full release notes' }))
    expect(openUrl).toHaveBeenCalledWith(
      'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.200'
    )
  })

  it('keeps the highlights on the downloading card instead of an empty paragraph', () => {
    const changelog: ChangelogData = {
      release: {
        title: 'Faster terminal start',
        description: '',
        highlights: ['Tabs restore in half the time', 'SSH panes keep their scrollback'],
        releaseNotesUrl: 'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.200'
      },
      releasesBehind: null
    }
    useAppStore.setState({
      updateStatus: { state: 'downloading', version: '1.4.200', percent: 40 },
      updateChangelog: changelog,
      dismissedUpdateVersion: null,
      updateCardCollapsed: false,
      updateReassuranceSeen: true
    })
    const { container } = render(<UpdateCard />)

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('p.text-sm.text-muted-foreground')).toBeNull()
  })

  it('keeps the one-paragraph summary when no highlights are present', () => {
    renderAvailable({
      release: {
        title: 'Orca Lab 1.4.200',
        description: 'fix: keep scrollback · feat: faster tabs',
        releaseNotesUrl: 'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.200'
      },
      releasesBehind: null
    })

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText('fix: keep scrollback · feat: faster tabs')).toBeTruthy()
  })
})
