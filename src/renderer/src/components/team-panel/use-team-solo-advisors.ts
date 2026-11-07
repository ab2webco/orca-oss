import { useEffect, useState } from 'react'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { onGameAdvisorChanged } from './game-advisor-signal'
import {
  parseGameMemberAdvisor,
  type GameMemberAdvisor
} from '../../../../shared/orchestrator-game-member-advisor'

/** One host's panes to ask about; null is this machine. */
export type TeamSoloAdvisorRead = { environmentId: string | null; paneKeys: string[] }

type Reports = ReadonlyMap<string, GameMemberAdvisor>

const READ_MS = 20_000
const READ_TIMEOUT_MS = 15_000
const NONE: Reports = new Map()

/** Parsed because a paired host may run another build. */
function reportsIn(result: { advisors?: unknown } | null): [string, GameMemberAdvisor][] {
  const listed = Array.isArray(result?.advisors) ? (result.advisors as unknown[]) : []
  return listed.flatMap((one) => {
    const { paneKey, advisor } = (one ?? {}) as { paneKey?: unknown; advisor?: unknown }
    const parsed = parseGameMemberAdvisor(advisor)
    return typeof paneKey === 'string' && parsed ? [[paneKey, parsed]] : []
  })
}

/**
 * Each pane's Jev report, by pane key; `readsJson` is a JSON list of `TeamSoloAdvisorRead`.
 * Why any failure reads as none: an older host has no such read, and a section is optional.
 */
export function useTeamSoloAdvisors(readsJson: string, active: boolean): Reports {
  const [reports, setReports] = useState<Reports>(NONE)
  useEffect(() => {
    if (!active) {
      return
    }
    let live = true
    const hosts = JSON.parse(readsJson) as TeamSoloAdvisorRead[]
    // Why: a push can start a read while a slower one is out, and the last to land must not win.
    const turns = new Map<TeamSoloAdvisorRead, number>()
    const land = (host: TeamSoloAdvisorRead): void => {
      const { environmentId, paneKeys } = host
      const turn = (turns.get(host) ?? 0) + 1
      turns.set(host, turn)
      const target: RuntimeClientTarget = environmentId
        ? { kind: 'environment', environmentId }
        : { kind: 'local' }
      void callRuntimeRpc<{ advisors?: unknown }>(
        target,
        'game.paneAdvisors',
        { paneKeys },
        { timeoutMs: READ_TIMEOUT_MS }
      )
        .catch(() => null)
        .then((result) => {
          if (!live || turns.get(host) !== turn) {
            return
          }
          setReports((held) => {
            const next = new Map(held)
            paneKeys.forEach((paneKey) => next.delete(paneKey))
            reportsIn(result).forEach(([paneKey, advisor]) => next.set(paneKey, advisor))
            return next
          })
        })
    }
    const read = (): void => hosts.forEach(land)
    read()
    // Why keep the timer: a report that expires, or a host older than the push, sends no signal.
    const timer = setInterval(read, READ_MS)
    const stops = [window.api.runtime.onGameAdvisorChanged?.(read), onGameAdvisorChanged(read)]
    return () => {
      live = false
      clearInterval(timer)
      stops.forEach((stop) => stop?.())
    }
  }, [active, readsJson])
  return reports
}
