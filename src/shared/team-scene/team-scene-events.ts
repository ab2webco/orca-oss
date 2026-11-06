import type { TeamSceneEvent, TeamSceneInput } from './team-scene-types'

/** The moments between two snapshots; the first snapshot has none, so opening replays nothing. */
export function teamSceneEventsBetween(
  prev: TeamSceneInput | null,
  next: TeamSceneInput
): TeamSceneEvent[] {
  if (!prev) {
    return []
  }
  const events: TeamSceneEvent[] = []
  const before = new Map(prev.members.map((m) => [m.key, m]))
  const after = new Set(next.members.map((m) => m.key))
  for (const m of prev.members) {
    if (!after.has(m.key)) {
      events.push({ kind: 'leave', key: m.key })
    }
  }
  for (const m of next.members) {
    const old = before.get(m.key)
    if (!old) {
      events.push({ kind: 'join', key: m.key })
      continue
    }
    if (m.reportId !== null && m.reportId !== old.reportId) {
      events.push({ kind: 'handoff', key: m.key })
    }
    if (m.mergedPr !== null && m.mergedPr !== old.mergedPr) {
      events.push({ kind: 'merge', key: m.key })
    }
  }
  const line = next.advisor?.line ?? null
  if (line !== null && line !== (prev.advisor?.line ?? null)) {
    events.push({ kind: 'advisorSpoke', line })
  }
  return events
}
