import { useEffect } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import { readTeamLeads } from './team-panel-lead-read'

// Why 30 s: game.leads is the host's in-memory lead registry, far cheaper than game.state.
const LEAD_REFRESH_MS = 30_000
const NONE: ReadonlySet<string> = new Set()

export function createGameLeadHandlesPoller(
  readLeads: (target: RuntimeClientTarget) => Promise<{ handle: string }[]>,
  publish: (handles: ReadonlySet<string>) => void,
  intervalMs: number
) {
  let active: { key: string; refs: number; timer: ReturnType<typeof setInterval> } | null = null
  let generation = 0

  const refresh = async (target: RuntimeClientTarget): Promise<void> => {
    const mine = generation
    try {
      const leads = await readLeads(target)
      if (mine === generation) {
        publish(new Set(leads.map((lead) => lead.handle)))
      }
    } catch {
      // Why keep the last leads: one failed read does not dethrone a lead.
    }
  }

  return {
    subscribe(key: string, target: RuntimeClientTarget): () => void {
      if (active?.key !== key) {
        if (active) {
          clearInterval(active.timer)
        }
        generation += 1
        publish(NONE)
        active = { key, refs: 0, timer: setInterval(() => void refresh(target), intervalMs) }
        void refresh(target)
      }
      const run = active
      run.refs += 1
      return () => {
        run.refs -= 1
        if (run.refs === 0 && active === run) {
          clearInterval(run.timer)
          active = null
          generation += 1
        }
      }
    }
  }
}

const useGameLeadHandlesStore = create<{ handles: ReadonlySet<string> }>(() => ({ handles: NONE }))

const poller = createGameLeadHandlesPoller(
  readTeamLeads,
  (handles) => useGameLeadHandlesStore.setState({ handles }),
  LEAD_REFRESH_MS
)

/** Terminal handles of the live game leads on the active workspace's host, for the sidebar crown. */
export function useGameLeadHandles(): ReadonlySet<string> {
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  useEffect(() => poller.subscribe(hostId ?? 'local', gameInboxTargetOf(hostId)), [hostId])
  return useGameLeadHandlesStore((s) => s.handles)
}
