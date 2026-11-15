/** What one workspace asks of the person right now; absent when it asks nothing. */
export type WorkspaceUrgencySignal = 'account-limit' | 'question' | 'working'

/** ORCA-1216 §4: 1 Needs you, 2 At risk, 3 Working, 4 Rest. Lower is more urgent. */
export type ProjectTier = 1 | 2 | 3 | 4

export type ProjectUrgencyReason =
  | { kind: 'account-limit' }
  | { kind: 'questions'; count: number }
  | { kind: 'ci-failing' }
  | { kind: 'working'; count: number }

export type ProjectUrgency = { tier: ProjectTier; reason: ProjectUrgencyReason | null }

const SIGNAL_RANK: Record<WorkspaceUrgencySignal, number> = {
  'account-limit': 0,
  question: 1,
  working: 2
}

/** Combines two sources for one workspace; an account limit names the fix more precisely than a prompt. */
export function strongerUrgencySignal(
  current: WorkspaceUrgencySignal | undefined,
  next: WorkspaceUrgencySignal
): WorkspaceUrgencySignal {
  return current !== undefined && SIGNAL_RANK[current] <= SIGNAL_RANK[next] ? current : next
}

/** A project's tier is its most urgent workspace; the reason is what its header says. */
export function classifyProjectUrgency(
  worktreeIds: readonly string[],
  signalByWorktreeId: ReadonlyMap<string, WorkspaceUrgencySignal>,
  isCIFailing: (worktreeId: string) => boolean
): ProjectUrgency {
  let accountLimited = false
  let questions = 0
  let working = 0
  let ciFailing = false
  for (const id of worktreeIds) {
    const signal = signalByWorktreeId.get(id)
    if (signal === 'account-limit') {
      accountLimited = true
    } else if (signal === 'question') {
      questions++
    } else if (signal === 'working') {
      working++
    }
    ciFailing ||= isCIFailing(id)
  }
  if (accountLimited) {
    return { tier: 1, reason: { kind: 'account-limit' } }
  }
  if (questions > 0) {
    return { tier: 1, reason: { kind: 'questions', count: questions } }
  }
  if (ciFailing) {
    return { tier: 2, reason: { kind: 'ci-failing' } }
  }
  if (working > 0) {
    return { tier: 3, reason: { kind: 'working', count: working } }
  }
  return { tier: 4, reason: null }
}
