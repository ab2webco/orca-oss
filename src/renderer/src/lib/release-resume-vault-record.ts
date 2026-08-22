// Releasing a held resume record (ORCA-271). "Release" means dropping the in-memory/persisted
// pointer Orca uses to auto-resume a pane — `sleepingAgentSessionsByPaneKey` — and nothing else.
// It never touches the on-disk transcript: there is no IPC call in this module at all, by
// construction, so there is no path from "release" to "delete transcript" (that action exists
// only in AI Vault's `aiVault.deleteSession`, a different, disk-owning feature this one must
// never reach into — see the ORCA-271 PR description).

import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  agentProviderSessionsEqual,
  type SleepingAgentSessionRecord
} from '../../../shared/agent-session-resume'
import { isSleepingAgentPaneCurrentlyWorking } from './resume-vault-records'

export type ResumeVaultReleaseOutcome =
  | { released: true }
  /** The record at this pane key is gone, or no longer the session the caller saw
   *  (a reused pane key picked up a fresh record) — never clear a record we didn't
   *  actually mean to touch. */
  | { released: false; reason: 'not-found' | 'changed' | 'currently-working' }

export type ResumeVaultReleaseTarget = {
  paneKey: string
  agent: SleepingAgentSessionRecord['agent']
  providerSession: SleepingAgentSessionRecord['providerSession']
}

function isSameSession(
  current: SleepingAgentSessionRecord,
  target: ResumeVaultReleaseTarget
): boolean {
  return (
    current.agent === target.agent &&
    agentProviderSessionsEqual(target.agent, current.providerSession, target.providerSession)
  )
}

/** Re-reads the store fresh (never a stale prop/closure snapshot) and re-verifies both the
 *  record's identity and the working guard at the moment of release — a sheet can stay open
 *  for minutes, long enough for a pane key to be reused by an unrelated session. */
export function releaseResumeVaultRecord(target: ResumeVaultReleaseTarget): ResumeVaultReleaseOutcome {
  const state: AppState = useAppStore.getState()
  const current = state.sleepingAgentSessionsByPaneKey[target.paneKey]
  if (!current) {
    return { released: false, reason: 'not-found' }
  }
  if (!isSameSession(current, target)) {
    return { released: false, reason: 'changed' }
  }
  if (isSleepingAgentPaneCurrentlyWorking(target.paneKey, state)) {
    return { released: false, reason: 'currently-working' }
  }
  state.clearSleepingAgentSessionsByPaneKey([target.paneKey])
  return { released: true }
}

export type ResumeVaultProjectReleaseResult = {
  releasedPaneKeys: string[]
  skippedCurrentlyWorking: string[]
}

/** Releases the records the caller actually showed the user (`expectedPaneKeys` — the
 *  group's entries at confirm time) that are still owned by the worktree and not
 *  currently working, re-checked fresh at call time. Scoping to the confirmed set (rather
 *  than "everything in this worktree right now") keeps the blast radius matching what the
 *  confirm dialog's count promised — a record that shows up after the sheet opened is
 *  never swept by a confirmation the user never saw it in. Used by the project group's
 *  "Release all" action. */
export function releaseResumeVaultProjectRecords(
  worktreeId: string,
  expectedPaneKeys: ReadonlySet<string>
): ResumeVaultProjectReleaseResult {
  const state: AppState = useAppStore.getState()
  const releasedPaneKeys: string[] = []
  const skippedCurrentlyWorking: string[] = []
  for (const [paneKey, record] of Object.entries(state.sleepingAgentSessionsByPaneKey)) {
    if (record.worktreeId !== worktreeId || !expectedPaneKeys.has(paneKey)) {
      continue
    }
    if (isSleepingAgentPaneCurrentlyWorking(paneKey, state)) {
      skippedCurrentlyWorking.push(paneKey)
      continue
    }
    releasedPaneKeys.push(paneKey)
  }
  if (releasedPaneKeys.length > 0) {
    state.clearSleepingAgentSessionsByPaneKey(releasedPaneKeys)
  }
  return { releasedPaneKeys, skippedCurrentlyWorking }
}
