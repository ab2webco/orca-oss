// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { useTabStartupCommand } from './use-tab-startup-command'

const TAB = 'tab-1'
const COMMAND = { command: 'claude' }

describe('useTabStartupCommand (ORCA-1189)', () => {
  let consume: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const real = useAppStore.getState().consumeTabStartupCommand
    consume = vi.fn((tabId: string) => real(tabId))
    useAppStore.setState({ consumeTabStartupCommand: consume })
    useAppStore.getState().queueTabStartupCommand(TAB, COMMAND)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ pendingStartupByTabId: {} })
  })

  const pending = () => useAppStore.getState().pendingStartupByTabId[TAB]

  it('keeps the command through a mount whose pane never got a PTY, so a remount still launches it', () => {
    const first = renderHook(() => useTabStartupCommand(TAB))
    expect(first.result.current.startup?.command).toBe('claude')
    // A pane parked while its host is unknown binds no PTY before the host loads.
    act(() => first.result.current.onPtyBound(null))
    expect(pending()?.command).toBe('claude')
    first.unmount()

    const remounted = renderHook(() => useTabStartupCommand(TAB))
    expect(remounted.result.current.startup?.command).toBe('claude')
    expect(consume).not.toHaveBeenCalled()
  })

  it('consumes the command once when the pane binds its PTY, so a later remount does not run it again', () => {
    const first = renderHook(() => useTabStartupCommand(TAB))
    act(() => first.result.current.onPtyBound('pty-1'))
    act(() => first.result.current.onPtyBound('pty-2'))
    expect(consume).toHaveBeenCalledTimes(1)
    expect(pending()).toBeUndefined()
    first.unmount()

    const remounted = renderHook(() => useTabStartupCommand(TAB))
    expect(remounted.result.current.startup).toBeUndefined()
  })

  it('treats a remote host PTY the same way: consumed once it binds, kept while parked', () => {
    const parked = renderHook(() => useTabStartupCommand(TAB))
    act(() => parked.result.current.onPtyBound(null))
    parked.unmount()
    const ssh = renderHook(() => useTabStartupCommand(TAB))
    expect(ssh.result.current.startup?.command).toBe('claude')
    act(() => ssh.result.current.onPtyBound('remote:ssh-host:pty-7'))
    expect(consume).toHaveBeenCalledTimes(1)
    expect(pending()).toBeUndefined()
  })

  it('does nothing for a tab with no queued command', () => {
    useAppStore.setState({ pendingStartupByTabId: {} })
    const plain = renderHook(() => useTabStartupCommand(TAB))
    act(() => plain.result.current.onPtyBound('pty-1'))
    expect(plain.result.current.startup).toBeUndefined()
    expect(consume).not.toHaveBeenCalled()
  })
})
