// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { MemoryPressureState } from '../../../../shared/memory-pressure-types'
import { useAppStore } from '../../store'
import { MemoryPressureWarningCard } from './MemoryPressureWarningCard'

const GIB = 1024 ** 3

const STATE: MemoryPressureState = {
  warning: {
    episodeId: 4,
    sweeping: false,
    trigger: 'kernel-pressure',
    minutesToExhaustion: null,
    reading: {
      totalMemory: 16 * GIB,
      availableMemory: GIB,
      swapTotal: 9 * GIB,
      swapUsed: 8 * GIB,
      kernelLevel: 'warn',
      source: 'sysctl',
      readAt: 0
    },
    panes: [
      {
        sessionId: 'sess-1',
        ptyId: 'pty-1',
        paneKey: null,
        worktreeId: 'repo::/w',
        worktreeName: 'w',
        repoName: 'cineco',
        memory: 5 * GIB,
        metric: 'phys-footprint',
        lastOutputAt: null
      }
    ]
  }
}

type PressureCallback = (state: MemoryPressureState) => void

describe('MemoryPressureWarningCard', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  let pushState: PressureCallback | null = null
  const memory = {
    getPressureWarning: vi.fn(async () => STATE),
    refreshPressureWarning: vi.fn(async () => ({ warning: null })),
    dismissPressureWarning: vi.fn(async () => undefined),
    onPressureWarning: vi.fn((callback: PressureCallback) => {
      pushState = callback
      return () => {}
    })
  }
  const pty = { kill: vi.fn(async () => undefined) }

  function setEnabled(enabled: boolean): void {
    useAppStore.setState({
      settings: { memoryPressureWarningEnabled: enabled } as GlobalSettings
    })
  }

  async function render(): Promise<HTMLDivElement> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    container = host
    root = createRoot(host)
    await act(async () => {
      root?.render(<MemoryPressureWarningCard />)
    })
    return host
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll('button')).find(
      (candidate) =>
        candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label
    )
    if (!found) {
      throw new Error(`no button ${label}`)
    }
    return found
  }

  beforeEach(() => {
    vi.clearAllMocks()
    pushState = null
    ;(window as unknown as { api: { memory: typeof memory; pty: typeof pty } }).api = {
      memory,
      pty
    }
    setEnabled(true)
    useAppStore.setState({
      tabsByWorktree: {
        'repo::/w': [
          {
            id: 'tab-1',
            ptyId: 'pty-1',
            worktreeId: 'repo::/w',
            title: 'claude',
            customTitle: 'Lead',
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] }
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    document.body.innerHTML = ''
    root = null
  })

  it('lists the heaviest terminals with their memory and project', async () => {
    const host = await render()

    expect(host.textContent).toContain('Memory is running low')
    expect(host.textContent).toContain('Lead')
    expect(host.textContent).toContain('cineco / w')
    expect(host.textContent).toContain('5.00 GB')
  })

  it('dismisses the current episode in main and hides', async () => {
    const host = await render()

    await act(async () => button('Dismiss').click())

    expect(memory.dismissPressureWarning).toHaveBeenCalledWith(4)
    expect(host.textContent).not.toContain('Memory is running low')
  })

  it('closes a terminal only after the confirm', async () => {
    await render()

    await act(async () => button('Close').click())
    expect(pty.kill).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Close Lead?')

    await act(async () => button('Close terminal').click())
    expect(pty.kill).toHaveBeenCalledWith('pty-1')
    expect(memory.refreshPressureWarning).toHaveBeenCalled()
  })

  it('shows nothing while the setting is off, even when main pushes a warning', async () => {
    setEnabled(false)
    const host = await render()

    act(() => pushState?.(STATE))

    expect(host.textContent).toBe('')
  })

  it('says what opened it, in plain words', async () => {
    const host = await render()
    expect(host.textContent).toContain(
      'The system has reported memory pressure for at least two minutes.'
    )

    act(() =>
      pushState?.({
        warning: { ...STATE.warning!, trigger: 'exhaustion-predicted', minutesToExhaustion: 7.4 }
      })
    )
    expect(host.textContent).toContain('At this rate, memory runs out in about 7 minutes.')

    act(() => pushState?.({ warning: { ...STATE.warning!, trigger: 'low-memory' } }))
    expect(host.textContent).toContain('Free memory has stayed under 10% for at least two minutes.')
  })

  it('says agent terminals come first', async () => {
    const host = await render()

    expect(host.textContent).toContain(
      'Terminals running agents come first, then the ones using the most memory.'
    )
  })
})
