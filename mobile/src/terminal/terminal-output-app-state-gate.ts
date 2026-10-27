import { useEffect } from 'react'
import { AppState, Platform, type AppStateStatus } from 'react-native'

// Why: iOS suspends WKWebView content processes off-screen; output posted then piles up as
// IPC the content process drains before answering the scene-transition handshake, and the
// main thread waits on it until the 0x8BADF00D watchdog kills the app (ORCA-811). Dropping
// is safe only where the return to active re-subscribes for a fresh snapshot (iOS).
export function shouldPauseTerminalOutput(appState: string, platform: string): boolean {
  return platform === 'ios' && (appState === 'inactive' || appState === 'background')
}

export function usePauseTerminalOutputWhileInactive(setPaused: (paused: boolean) => void): void {
  useEffect(() => {
    setPaused(shouldPauseTerminalOutput(AppState.currentState, Platform.OS))
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      setPaused(shouldPauseTerminalOutput(state, Platform.OS))
    })
    return () => subscription.remove()
  }, [setPaused])
}
