import { useEffect, useState } from 'react'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { GAME_MEMBER_ADVISOR_PANES_MAX } from '../../../../shared/orchestrator-game-member-advisor'
import type { GameMemberAccount } from '../../../../shared/orchestrator-game-state'
import type { TeamSoloSession } from '../../../../shared/team-panel-activity-rows'

type PaneAccountQuery = { paneKey: string; agentType: string | null; worktreeId: string | null }

/** One host's panes to ask about; null is this machine. */
export type TeamSoloAccountRead = { environmentId: string | null; panes: PaneAccountQuery[] }

/** A pane's account as its host names it; null is the host's own login. Absent: not answered. */
export type TeamSoloPaneAccounts = ReadonlyMap<string, GameMemberAccount | null>

const READ_MS = 20_000
const READ_TIMEOUT_MS = 15_000
const NONE: TeamSoloPaneAccounts = new Map()

/** The panes whose account a host can name, grouped by host; an unpaired remote one is never asked. */
export function teamSoloAccountReadsOf(
  sessions: readonly Pick<TeamSoloSession, 'entry' | 'host'>[]
): TeamSoloAccountRead[] {
  const reads = new Map<string | null, PaneAccountQuery[]>()
  for (const { host, entry } of sessions) {
    if (host.kind === 'remote' && !host.environmentId) {
      continue
    }
    const environmentId = host.kind === 'remote' ? host.environmentId : null
    const pane = {
      paneKey: entry.paneKey,
      agentType: entry.agentType ?? null,
      worktreeId: entry.worktreeId ?? null
    }
    reads.set(environmentId, [...(reads.get(environmentId) ?? []), pane])
  }
  return [...reads].map(([environmentId, panes]) => ({
    environmentId,
    panes: panes.slice(0, GAME_MEMBER_ADVISOR_PANES_MAX)
  }))
}

/** Parsed because a paired host may run another build. */
function accountsIn(result: { accounts?: unknown } | null): [string, GameMemberAccount | null][] {
  const listed = Array.isArray(result?.accounts) ? (result.accounts as unknown[]) : []
  return listed.flatMap((one): [string, GameMemberAccount | null][] => {
    const { paneKey, account } = (one ?? {}) as { paneKey?: unknown; account?: unknown }
    if (typeof paneKey !== 'string') {
      return []
    }
    const named = account as Partial<GameMemberAccount> | null
    if (named === null) {
      return [[paneKey, null]]
    }
    return (named?.provider === 'claude' || named?.provider === 'codex') &&
      typeof named.email === 'string' &&
      typeof named.id === 'string'
      ? [[paneKey, { provider: named.provider, id: named.id, email: named.email }]]
      : []
  })
}

/**
 * Each pane's account by pane key, as game.state names a member's; `readsJson` is a JSON list
 * of `TeamSoloAccountRead`. Why a failure reads as none: an older host has no such read.
 */
export function useTeamSoloAccounts(readsJson: string, active: boolean): TeamSoloPaneAccounts {
  const [accounts, setAccounts] = useState<TeamSoloPaneAccounts>(NONE)
  useEffect(() => {
    if (!active) {
      return
    }
    let live = true
    const hosts = JSON.parse(readsJson) as TeamSoloAccountRead[]
    const read = (): void => {
      for (const { environmentId, panes } of hosts) {
        const target: RuntimeClientTarget = environmentId
          ? { kind: 'environment', environmentId }
          : { kind: 'local' }
        void callRuntimeRpc<{ accounts?: unknown }>(
          target,
          'game.paneAccounts',
          { panes },
          { timeoutMs: READ_TIMEOUT_MS }
        )
          .catch(() => null)
          .then((result) => {
            if (!live) {
              return
            }
            setAccounts((held) => {
              const next = new Map(held)
              panes.forEach((pane) => next.delete(pane.paneKey))
              accountsIn(result).forEach(([paneKey, account]) => next.set(paneKey, account))
              return next
            })
          })
      }
    }
    read()
    const timer = setInterval(read, READ_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [active, readsJson])
  return accounts
}
