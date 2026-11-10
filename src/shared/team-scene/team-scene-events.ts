import type {
  TeamSceneAgentInput,
  TeamSceneEvent,
  TeamSceneGesture,
  TeamSceneInput
} from './team-scene-types'

type Decision = NonNullable<TeamSceneAgentInput['decisions']>[number]

const GESTURES = new Set<string>([
  'lowered',
  'raised',
  'approved',
  'unsure',
  'escalated',
  'ciRunning',
  'ciPassed',
  'ciFailed',
  'stopped',
  'consulting',
  'advised'
])
// Why by verdict: a decision with no gesture of its own still reads as its card colour.
const VERDICT_GESTURE: Record<string, TeamSceneGesture> = {
  deny: 'escalated',
  ask: 'unsure',
  allow: 'approved'
}

const gestureOf = (decision: Decision): TeamSceneGesture =>
  decision.gesture && GESTURES.has(decision.gesture)
    ? (decision.gesture as TeamSceneGesture)
    : (VERDICT_GESTURE[decision.verdict] ?? 'advised')

// Why only the newest: the decisions ride a 30 s poll, so several arrive at once.
function newestDecisionOf(
  now: TeamSceneAgentInput,
  then: TeamSceneAgentInput | undefined
): Decision | undefined {
  if (!then) {
    return undefined
  }
  const seen = new Set((then.decisions ?? []).map((one) => one.id))
  return (now.decisions ?? []).findLast((one) => !seen.has(one.id))
}

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
    if (m.activity === 'done' && old.activity !== 'done') {
      events.push({ kind: 'finish', key: m.key })
    }
    if (m.mergedPr !== null && m.mergedPr !== old.mergedPr) {
      events.push({ kind: 'merge', key: m.key })
    }
  }
  const panes: [string, TeamSceneAgentInput, TeamSceneAgentInput | undefined][] = [
    ['lead', next.lead, prev.lead],
    ...next.members.map((m): [string, TeamSceneAgentInput, TeamSceneAgentInput | undefined] => [
      m.key,
      m,
      before.get(m.key)
    ])
  ]
  for (const [key, now, then] of panes) {
    const judged = newestDecisionOf(now, then)
    if (judged) {
      events.push({ kind: 'judged', key, gesture: gestureOf(judged) })
    }
  }
  const line = next.advisor?.line ?? null
  if (line !== null && line !== (prev.advisor?.line ?? null)) {
    events.push({ kind: 'advisorSpoke', line })
  }
  return events
}
