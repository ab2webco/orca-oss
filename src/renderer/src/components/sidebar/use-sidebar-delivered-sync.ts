import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { readTeamHistory } from '@/components/team-panel/team-panel-lead-read'
import { useTeamPanelTarget } from '@/components/team-panel/use-team-panel-model'
import type { GameHistoryRecord } from '../../../../shared/orchestrator-game-history'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'
import { deliveredMembersOf } from './sidebar-delivered-members'
import { useSidebarDeliveredStore } from './sidebar-delivered-store'

// Why 60 s: history changes only when the lead frees a member, and a member list change reads at once.
const HISTORY_REFRESH_MS = 60_000

const NO_RECORDS: readonly GameHistoryRecord[] = []

function queuedNumbersOf(queue: TeamPanelGameModel['queue']): ReadonlySet<number> {
  const entries = queue?.kind === 'ready' ? queue.value : []
  return new Set(entries.flatMap((one) => Number(one.label.match(/\d+/)?.[0]) || []))
}

/** Publishes the lead's freed members for the sidebar's Delivered group, from the lead's own history. */
export function useSidebarDeliveredSync(
  team: Pick<TeamPanelGameModel, 'projectName' | 'queue'> & {
    lead: TeamLeadCard
    members: readonly TeamMemberCard[]
  }
): void {
  const { lead, members } = team
  const target = useTeamPanelTarget()
  const [records, setRecords] = useState<readonly GameHistoryRecord[]>(NO_RECORDS)
  const liveKey = members.map((one) => one.worktreeId ?? one.paneKey).join('\n')
  const leadWorktreeId = lead.worktreeId
  const leadHandle = lead.terminalHandle
  useEffect(() => {
    if (!target || !leadWorktreeId || !leadHandle) {
      setRecords(NO_RECORDS)
      return
    }
    let live = true
    const read = (): void => {
      readTeamHistory(target, { worktreeId: leadWorktreeId, terminalHandle: leadHandle }).then(
        (next) => live && setRecords(next),
        // Why keep the last read: a failed one says nothing about who was freed.
        () => undefined
      )
    }
    read()
    const timer = setInterval(read, HISTORY_REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
    // Why the live members: a member that just ended is in the history now, not in a minute.
  }, [target, leadWorktreeId, leadHandle, liveKey])

  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const lineage = useAppStore((s) => s.worktreeLineageById)
  const delivered = useMemo(() => {
    if (!leadWorktreeId || records.length === 0) {
      return {}
    }
    const worktrees = Object.values(worktreesByRepo)
      .flat()
      .map((one) => ({
        id: one.id,
        branch: one.branch ?? null,
        parentWorktreeId: lineage[one.id]?.parentWorktreeId ?? null
      }))
    const liveWorktreeIds = new Set(members.flatMap((one) => one.worktreeId ?? []))
    return deliveredMembersOf({ records, leadWorktreeId, liveWorktreeIds, worktrees })
  }, [records, leadWorktreeId, worktreesByRepo, lineage, members])

  const queuedPrNumbers = useMemo(() => queuedNumbersOf(team.queue), [team.queue])
  useEffect(() => {
    useSidebarDeliveredStore.setState({
      delivered,
      history: records,
      projectName: team.projectName,
      queuedPrNumbers
    })
  }, [delivered, records, team.projectName, queuedPrNumbers])
  useEffect(
    () => () =>
      useSidebarDeliveredStore.setState({ delivered: {}, history: NO_RECORDS, projectName: null }),
    []
  )
}
