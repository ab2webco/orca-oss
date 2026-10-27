import { createElement, createRef } from 'react'
import { AppState, Platform } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalWebView } from './TerminalWebView'
import type { TerminalWebViewHandle } from './terminal-webview-contract'
import { shouldRecoverTerminalOnAppStateChange } from './terminal-foreground-recovery'
import { shouldPauseTerminalOutput } from './terminal-output-app-state-gate'
import { TERMINAL_WRITE_FLUSH_WINDOW_MS } from './terminal-write-coalescer'

const nativeWebViewMethods = vi.hoisted(() => ({
  postMessage: vi.fn<(message: string) => void>(),
  reload: vi.fn<() => void>()
}))

const appStateListeners = vi.hoisted(() => new Set<(state: string) => void>())

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appStateListeners.add(listener)
      return { remove: () => appStateListeners.delete(listener) }
    }
  },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    create: (styles: unknown) => styles
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-webview', async () => {
  const React = await import('react')
  const WebView = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => nativeWebViewMethods)
    return React.createElement('WebView', props)
  })
  return { WebView, default: WebView }
})

vi.mock('lucide-react-native', () => ({
  RefreshCw: 'RefreshCw'
}))

const mutableAppState = AppState as { currentState: string }
const mutablePlatform = Platform as { OS: string }
const activeRenderers: ReactTestRenderer[] = []

function renderReadyTerminal() {
  const terminalRef = createRef<TerminalWebViewHandle>()
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(TerminalWebView, { ref: terminalRef }))
  })
  activeRenderers.push(renderer)
  const webView = renderer.root.findByType('WebView')
  act(() => {
    webView.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'web-ready' }) } })
  })
  nativeWebViewMethods.postMessage.mockClear()
  return terminalRef
}

function emitAppState(state: string) {
  mutableAppState.currentState = state
  act(() => {
    for (const listener of Array.from(appStateListeners)) {
      listener(state)
    }
  })
}

function postedWrites(): string[] {
  return nativeWebViewMethods.postMessage.mock.calls
    .map(([message]) => JSON.parse(message) as { type: string; data?: string })
    .filter((command) => command.type === 'write')
    .map((command) => command.data ?? '')
}

function postedTypes(): string[] {
  return nativeWebViewMethods.postMessage.mock.calls.map(
    ([message]) => (JSON.parse(message) as { type: string }).type
  )
}

describe('terminal output while the app is not active (ORCA-811)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mutableAppState.currentState = 'active'
    mutablePlatform.OS = 'ios'
  })

  afterEach(() => {
    act(() => {
      for (const renderer of activeRenderers.splice(0)) {
        renderer.unmount()
      }
    })
    appStateListeners.clear()
    nativeWebViewMethods.postMessage.mockReset()
    vi.useRealTimers()
  })

  it('posts no output into the iOS WebView while the app is inactive or backgrounded', () => {
    const terminalRef = renderReadyTerminal()

    emitAppState('inactive')
    act(() => terminalRef.current?.write('during-inactive'))
    emitAppState('background')
    act(() => terminalRef.current?.write('during-background'))
    act(() => vi.advanceTimersByTime(TERMINAL_WRITE_FLUSH_WINDOW_MS * 4))

    expect(postedWrites()).toEqual([])
  })

  it('drops a trailing batch that was still pending when the app went inactive', () => {
    const terminalRef = renderReadyTerminal()

    act(() => {
      terminalRef.current?.write('leading')
      terminalRef.current?.write('trailing')
    })
    emitAppState('inactive')
    act(() => vi.advanceTimersByTime(TERMINAL_WRITE_FLUSH_WINDOW_MS * 2))

    expect(postedWrites()).toEqual(['leading'])
  })

  it('resumes live output on return and replays only the recovery snapshot', () => {
    const terminalRef = renderReadyTerminal()

    emitAppState('background')
    act(() => terminalRef.current?.write('superseded-by-snapshot'))
    emitAppState('active')
    act(() => {
      terminalRef.current?.init(80, 24, 'snapshot')
      terminalRef.current?.write('live-after-return')
    })
    act(() => vi.advanceTimersByTime(TERMINAL_WRITE_FLUSH_WINDOW_MS))

    expect(postedTypes()).toEqual(['init', 'write'])
    expect(postedWrites()).toEqual(['live-after-return'])
  })

  it('starts paused when it mounts while the app is already in the background', () => {
    mutableAppState.currentState = 'background'
    const terminalRef = renderReadyTerminal()

    act(() => terminalRef.current?.write('mounted-in-background'))

    expect(postedWrites()).toEqual([])
  })

  it('keeps Android output flowing because Android has no snapshot recovery on return', () => {
    mutablePlatform.OS = 'android'
    const terminalRef = renderReadyTerminal()

    emitAppState('background')
    act(() => terminalRef.current?.write('android-background'))

    expect(postedWrites()).toEqual(['android-background'])
  })

  it('pauses only in states whose return to active triggers snapshot recovery', () => {
    // Why: dropped output is only safe because recovery re-subscribes for a fresh snapshot.
    for (const state of ['active', 'inactive', 'background', 'unknown', 'extension']) {
      for (const platform of ['ios', 'android']) {
        if (shouldPauseTerminalOutput(state, platform)) {
          expect(shouldRecoverTerminalOnAppStateChange(state, 'active', platform)).toBe(true)
        }
      }
    }
    expect(shouldPauseTerminalOutput('inactive', 'ios')).toBe(true)
    expect(shouldPauseTerminalOutput('background', 'ios')).toBe(true)
    expect(shouldPauseTerminalOutput('active', 'ios')).toBe(false)
  })

  it('stops listening to AppState once the terminal unmounts', () => {
    renderReadyTerminal()
    expect(appStateListeners.size).toBe(1)

    act(() => {
      for (const renderer of activeRenderers.splice(0)) {
        renderer.unmount()
      }
    })

    expect(appStateListeners.size).toBe(0)
  })
})
