// Grouping/derivation logic for the preserved resume-record panel (ORCA-271).
// Pure and store-agnostic so it stays testable without mounting React.

import type { AppState } from '@/store/types'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { isFreshNonDoneAgentStatus } from '../../../shared/agent-status-types'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'

/** Mirrors ORCA-272's own vocabulary for "why a record survived": the record's last
 *  captured state either reported completion (`finished`), reported a cancellation
 *  (`interrupted`), or was still mid-turn when captured, so its true outcome was never
 *  observed (`unknown`). This is the record's *captured* state, not its current live
 *  state — see `isSleepingAgentPaneCurrentlyWorking` for that. */
export type ResumeVaultHeldReason = 'finished' | 'interrupted' | 'unknown'

export function getResumeVaultHeldReason(
  record: Pick<SleepingAgentSessionRecord, 'state' | 'interrupted'>
): ResumeVaultHeldReason {
  if (record.state !== 'done') {
    return 'unknown'
  }
  return record.interrupted === true ? 'interrupted' : 'finished'
}

type ResumeVaultLiveStatusState = Pick<AppState, 'agentStatusByPaneKey' | 'retainedAgentsByPaneKey'>

/** True only when the pane's *live* status is fresh and not done — reuses the same
 *  freshness threshold the worktree sidebar dot uses, so a hook stream that has gone
 *  silent for a while does not lock a record behind an un-releasable guard forever. */
export function isSleepingAgentPaneCurrentlyWorking(
  paneKey: string,
  state: ResumeVaultLiveStatusState,
  now = Date.now()
): boolean {
  const live = state.agentStatusByPaneKey[paneKey]
  const retained = state.retainedAgentsByPaneKey[paneKey]?.entry
  return isFreshNonDoneAgentStatus(live, now) || isFreshNonDoneAgentStatus(retained, now)
}

export type ResumeVaultWorktreeIdentity = {
  worktreeId: string
  repoId: string | null
  repoDisplayName: string
  worktreeDisplayName: string
  worktreePath: string
  branch: string | null
  /** False when the worktree no longer exists in the store — removed, a not-yet-connected
   *  SSH/runtime host, or a folder workspace closed elsewhere. The record still shows
   *  identifying detail parsed from its id; it just cannot be resolved to a live object. */
  isAvailable: boolean
}

/** worktree.id is `${repoId}::${path}` (see Worktree.id) — used only as a last-resort
 *  fallback when the worktree object itself is gone from the store. */
function splitLegacyWorktreeId(worktreeId: string): { repoId: string; path: string } | null {
  const separatorIndex = worktreeId.indexOf('::')
  if (separatorIndex === -1) {
    return null
  }
  return { repoId: worktreeId.slice(0, separatorIndex), path: worktreeId.slice(separatorIndex + 2) }
}

export function resolveResumeVaultWorktreeIdentity(
  worktreeId: string,
  state: Pick<AppState, 'worktreesByRepo' | 'repos'>
): ResumeVaultWorktreeIdentity {
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  if (worktree) {
    const repo = state.repos.find((candidate) => candidate.id === worktree.repoId) ?? null
    return {
      worktreeId,
      repoId: worktree.repoId,
      repoDisplayName: repo?.displayName ?? worktree.repoId,
      worktreeDisplayName: worktree.displayName,
      worktreePath: worktree.path,
      branch: worktree.branch,
      isAvailable: true
    }
  }
  const legacy = splitLegacyWorktreeId(worktreeId)
  const repo = legacy ? (state.repos.find((candidate) => candidate.id === legacy.repoId) ?? null) : null
  return {
    worktreeId,
    repoId: legacy?.repoId ?? null,
    repoDisplayName: repo?.displayName ?? legacy?.repoId ?? worktreeId,
    worktreeDisplayName: legacy?.path ?? worktreeId,
    worktreePath: legacy?.path ?? worktreeId,
    branch: null,
    isAvailable: false
  }
}

export type ResumeVaultEntry = {
  paneKey: string
  record: SleepingAgentSessionRecord
  heldReason: ResumeVaultHeldReason
  isCurrentlyWorking: boolean
}

export type ResumeVaultProjectGroup = {
  worktreeId: string
  identity: ResumeVaultWorktreeIdentity
  entries: ResumeVaultEntry[]
}

export type ResumeVaultSourceState = Pick<
  AppState,
  | 'sleepingAgentSessionsByPaneKey'
  | 'worktreesByRepo'
  | 'repos'
  | 'agentStatusByPaneKey'
  | 'retainedAgentsByPaneKey'
>

export function buildResumeVaultProjectGroups(
  state: ResumeVaultSourceState,
  now = Date.now()
): ResumeVaultProjectGroup[] {
  const groupsByWorktreeId = new Map<string, ResumeVaultProjectGroup>()
  for (const [paneKey, record] of Object.entries(state.sleepingAgentSessionsByPaneKey)) {
    let group = groupsByWorktreeId.get(record.worktreeId)
    if (!group) {
      group = {
        worktreeId: record.worktreeId,
        identity: resolveResumeVaultWorktreeIdentity(record.worktreeId, state),
        entries: []
      }
      groupsByWorktreeId.set(record.worktreeId, group)
    }
    group.entries.push({
      paneKey,
      record,
      heldReason: getResumeVaultHeldReason(record),
      isCurrentlyWorking: isSleepingAgentPaneCurrentlyWorking(paneKey, state, now)
    })
  }

  const groups = Array.from(groupsByWorktreeId.values())
  for (const group of groups) {
    group.entries.sort((a, b) => b.record.updatedAt - a.record.updatedAt)
  }
  groups.sort(
    (a, b) =>
      a.identity.repoDisplayName.localeCompare(b.identity.repoDisplayName) ||
      a.identity.worktreeDisplayName.localeCompare(b.identity.worktreeDisplayName)
  )
  return groups
}
