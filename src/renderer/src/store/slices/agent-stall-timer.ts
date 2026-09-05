import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  advanceAgentStallTimer,
  type AgentStallTickOutcome,
  type AgentStallTimerIntervalMinutes,
  type AgentStallTimerState
} from '../../../../shared/agent-stall-timer'
import type { WorktreeProgressProbeResult } from '../../../../shared/worktree-progress-probe'

export type AgentStallTimerStatus =
  /** Armed, and the last reading showed the worktree moving. */
  | 'watching'
  /** Armed, and the worktree stopped moving; already escalated once. */
  | 'stalled'
  /** Armed, but git could not be read on the last tick. */
  | 'unreadable'

export type AgentStallTimerEntry = {
  intervalMinutes: AgentStallTimerIntervalMinutes
  /** Epoch ms of the next due reading; the driver polls a shared clock, so this is a deadline. */
  nextTickAt: number
  detector: AgentStallTimerState
  status: AgentStallTimerStatus
}

export type AgentStallTimerTick = {
  probe: WorktreeProgressProbeResult
  now: number
}

/** `null` when the pane is not armed; `disarmed` when the workspace has no git to read. */
export type AgentStallTickApplication = AgentStallTickOutcome | 'disarmed' | null

/**
 * Per-pane "check if it is stuck" timers. Session-scoped on purpose: the progress baseline
 * does not survive a restart, and rearming against a fresh baseline would silently restart
 * the stall window without telling anyone.
 */
export type AgentStallTimerSlice = {
  agentStallTimerByPaneKey: Record<string, AgentStallTimerEntry>
  /** Passing null disarms. Arming schedules the first reading one interval out. */
  setAgentStallTimer: (
    paneKey: string,
    intervalMinutes: AgentStallTimerIntervalMinutes | null,
    now?: number
  ) => void
  /** Seeds the baseline captured at arming time, without scoring it as a tick. */
  seedAgentStallTimerBaseline: (paneKey: string, probe: WorktreeProgressProbeResult) => void
  applyAgentStallTick: (paneKey: string, tick: AgentStallTimerTick) => AgentStallTickApplication
  clearAgentStallTimersByTabPrefix: (tabIdPrefix: string) => void
  clearAgentStallTimersByWorktree: (worktreeId: string) => void
}

const MINUTE_MS = 60_000

export const createAgentStallTimerSlice: StateCreator<AppState, [], [], AgentStallTimerSlice> = (
  set,
  get
) => ({
  agentStallTimerByPaneKey: {},

  setAgentStallTimer: (paneKey, intervalMinutes, now = Date.now()) => {
    set((s) => {
      if (intervalMinutes === null) {
        if (!(paneKey in s.agentStallTimerByPaneKey)) {
          return s
        }
        const next = { ...s.agentStallTimerByPaneKey }
        delete next[paneKey]
        return { agentStallTimerByPaneKey: next }
      }
      return {
        agentStallTimerByPaneKey: {
          ...s.agentStallTimerByPaneKey,
          [paneKey]: {
            intervalMinutes,
            nextTickAt: now + intervalMinutes * MINUTE_MS,
            detector: { lastFingerprint: null, escalated: false },
            status: 'watching'
          }
        }
      }
    })
  },

  seedAgentStallTimerBaseline: (paneKey, probe) => {
    set((s) => {
      const entry = s.agentStallTimerByPaneKey[paneKey]
      // Only an unset baseline seeds; a slow arming read must not overwrite a scored tick.
      if (!entry || probe.kind !== 'fingerprint' || entry.detector.lastFingerprint !== null) {
        return s
      }
      return {
        agentStallTimerByPaneKey: {
          ...s.agentStallTimerByPaneKey,
          [paneKey]: { ...entry, detector: { lastFingerprint: probe.value, escalated: false } }
        }
      }
    })
  },

  applyAgentStallTick: (paneKey, { probe, now }) => {
    const entry = get().agentStallTimerByPaneKey[paneKey]
    if (!entry) {
      return null
    }

    // A folder workspace has no git to measure, so the timer disarms rather than sitting
    // armed on a signal it can never read.
    if (probe.kind === 'unsupported') {
      set((s) => {
        const next = { ...s.agentStallTimerByPaneKey }
        delete next[paneKey]
        return { agentStallTimerByPaneKey: next }
      })
      return 'disarmed'
    }

    const { state, outcome } = advanceAgentStallTimer(entry.detector, probe)
    const status: AgentStallTimerStatus =
      outcome === 'unreadable' ? 'unreadable' : outcome === 'progressing' ? 'watching' : 'stalled'
    set((s) => ({
      agentStallTimerByPaneKey: {
        ...s.agentStallTimerByPaneKey,
        [paneKey]: {
          ...entry,
          detector: state,
          status,
          nextTickAt: now + entry.intervalMinutes * MINUTE_MS
        }
      }
    }))
    return outcome
  },

  clearAgentStallTimersByTabPrefix: (tabIdPrefix) => {
    set((s) => clearTimersByTabPrefixes(s.agentStallTimerByPaneKey, [`${tabIdPrefix}:`]) ?? s)
  },

  clearAgentStallTimersByWorktree: (worktreeId) => {
    // Entries carry no worktreeId, so this must run while the worktree's tabs are still in
    // tabsByWorktree; removeWorktree prunes them only after terminal teardown.
    set((s) => {
      const prefixes = (s.tabsByWorktree[worktreeId] ?? []).map((tab) => `${tab.id}:`)
      return clearTimersByTabPrefixes(s.agentStallTimerByPaneKey, prefixes) ?? s
    })
  }
})

function clearTimersByTabPrefixes(
  entries: Record<string, AgentStallTimerEntry>,
  tabPrefixes: string[]
): Pick<AgentStallTimerSlice, 'agentStallTimerByPaneKey'> | null {
  if (tabPrefixes.length === 0) {
    return null
  }
  const staleKeys = Object.keys(entries).filter((paneKey) =>
    tabPrefixes.some((prefix) => paneKey.startsWith(prefix))
  )
  if (staleKeys.length === 0) {
    return null
  }
  const next = { ...entries }
  for (const paneKey of staleKeys) {
    delete next[paneKey]
  }
  return { agentStallTimerByPaneKey: next }
}
