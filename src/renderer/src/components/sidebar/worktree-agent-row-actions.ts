import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { deriveRunningAgentSendTargets } from '@/lib/running-agent-targets'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { dismissStaleAgentRowByKey } from '../terminal-pane/stale-agent-row'
import {
  selectSendTargetControlInputs,
  selectSendTargetInputs
} from './worktree-card-send-target-inputs'

export type AgentSendTarget = {
  status: 'eligible' | 'disabled' | 'sending'
  disabledReason?: string
}

/** Focuses an agent row's pane in its worktree; a row whose pane is gone is dropped. */
export function activateWorktreeAgentTab(worktreeId: string, tabId: string, paneKey: string): void {
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    // Why: malformed/legacy numeric keys can't be resolved after pane replay/remount, so drop the stale row instead of guessing.
    console.warn('[WorktreeCardAgents] malformed paneKey, skipping pane focus', paneKey)
    dismissStaleAgentRowByKey(paneKey)
    return
  }
  if (parsed.tabId !== tabId) {
    console.warn('[WorktreeCardAgents] paneKey tabId mismatch, dismissing row', {
      tabId,
      paneKey
    })
    dismissStaleAgentRowByKey(paneKey)
    return
  }
  // Why: design-doc rule — every user-initiated worktree switch must route through activateAndRevealWorktree (cross-repo activation + nav history).
  activateAndRevealWorktree(worktreeId)
  const tabs = useAppStore.getState().tabsByWorktree[worktreeId] ?? []
  if (tabs.some((t) => t.id === tabId)) {
    activateTabAndFocusPane(tabId, parsed.leafId, {
      ackPaneKeyOnSuccess: paneKey,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
    return
  }
  const liveEntry = useAppStore.getState().agentStatusByPaneKey[paneKey]
  if (liveEntry?.worktreeId === worktreeId) {
    // Why: orchestration worker status can be worktree-attributed before the renderer knows its tab; keep the live row instead of dismissing as stale.
    return
  }
  dismissStaleAgentRowByKey(paneKey)
}

/** The inline list's X: drops the live status and any retained snapshot of the pane. */
export function dismissWorktreeAgent(paneKey: string): void {
  const state = useAppStore.getState()
  state.dropAgentStatus(paneKey)
  state.dismissRetainedAgent(paneKey)
}

/** While a prompt waits for a target, each of this worktree's agents as a pick. */
export function useWorktreeAgentSendTargets(worktreeId: string): {
  active: boolean
  targetsByPaneKey: ReadonlyMap<string, AgentSendTarget>
  onSendTargetClick: (paneKey: string) => void
} {
  const { targetMode, agentStatusEpoch } = useAppStore(
    useShallow((s) => selectSendTargetControlInputs(s, worktreeId))
  )
  // Why: return a stable empty constant unless the send-target popover is ours, so churny pane-title/agent-status maps don't re-render idle bodies.
  const sendTargetInputs = useAppStore(useShallow((s) => selectSendTargetInputs(s, worktreeId)))
  const sendPromptToSidebarAgentTarget = useAppStore((s) => s.sendPromptToSidebarAgentTarget)
  const active = targetMode !== null
  const targetsByPaneKey = useMemo(() => {
    void agentStatusEpoch
    if (!active) {
      return new Map<string, AgentSendTarget>()
    }
    return new Map(
      deriveRunningAgentSendTargets(sendTargetInputs, worktreeId).map((target) => [
        target.paneKey,
        targetMode?.status === 'sending' && targetMode.sendingPaneKey === target.paneKey
          ? { status: 'sending' as const, disabledReason: 'Sending...' }
          : target.disabledReason
            ? { status: target.status, disabledReason: target.disabledReason }
            : { status: target.status }
      ])
    )
  }, [
    // Why: stale-boundary timers bump this epoch without replacing the status map, so re-derive when freshness flips.
    agentStatusEpoch,
    targetMode?.sendingPaneKey,
    targetMode?.status,
    active,
    // sendTargetInputs: stable empty when inactive, shallow bundle of the five maps when active — one ref covers all five deps.
    sendTargetInputs,
    worktreeId
  ])
  const onSendTargetClick = useCallback(
    (paneKey: string) => {
      void sendPromptToSidebarAgentTarget(paneKey)
    },
    [sendPromptToSidebarAgentTarget]
  )
  return { active, targetsByPaneKey, onSendTargetClick }
}
