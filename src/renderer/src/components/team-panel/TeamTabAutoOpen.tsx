import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { useTeamPanelKind } from './use-team-panel-model'
import {
  markTeamTabDefaulted,
  openTeamTabOnLeadStart,
  readTeamTabDefaulted
} from './team-tab-auto-open'

/** Opens Team on a lead start, and makes it the first tab a team project shows (ORCA-1414). */
export function TeamTabAutoOpen(): null {
  const kind = useTeamPanelKind()
  const ready = useAppStore((s) => s.persistedUIReady)

  useEffect(() => window.api.runtime.onGameLeadStarted?.(openTeamTabOnLeadStart), [])

  // Why any change after hydration: a click, a shortcut or a flow that moved the tab is a tab chosen.
  useEffect(
    () =>
      useAppStore.subscribe((next, prev) => {
        if (prev.persistedUIReady && next.rightSidebarTab !== prev.rightSidebarTab) {
          markTeamTabDefaulted()
        }
      }),
    []
  )

  useEffect(() => {
    if (!ready || kind !== 'team') {
      return
    }
    let disposed = false
    void readTeamTabDefaulted().then((done) => {
      if (disposed || done) {
        return
      }
      // Why not open the sidebar: a closed one is the person's choice; it shows Team when reopened.
      useAppStore.getState().setRightSidebarTab('team')
      markTeamTabDefaulted()
    })
    return () => {
      disposed = true
    }
  }, [ready, kind])

  return null
}
