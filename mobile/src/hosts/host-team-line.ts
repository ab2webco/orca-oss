export type HostLeadCaller = { worktreeId: string; terminalHandle: string; paneKey: string }

export type HostTeamLine = { members: number; working: number; needsYou: number }

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

/** The live leads that name their worktree and pane; an older CLI's lead names neither, so it has no line. */
export function hostLeadCallersOf(raw: unknown): HostLeadCaller[] {
  const leads = isRecord(raw) && Array.isArray(raw.leads) ? raw.leads : []
  return leads.flatMap((one) => {
    if (!isRecord(one)) {
      return []
    }
    const worktreeId = text(one.worktreeId)
    const terminalHandle = text(one.handle)
    const paneKey = text(one.paneKey)
    return worktreeId && terminalHandle && paneKey ? [{ worktreeId, terminalHandle, paneKey }] : []
  })
}

/** Adds up the members of every lead team in the given game.state answers; null when none has a team. */
export function hostTeamLineOf(states: readonly unknown[]): HostTeamLine | null {
  let members = 0
  let working = 0
  let needsYou = 0
  let hasTeam = false
  for (const state of states) {
    if (!isRecord(state) || state.role !== 'lead' || !Array.isArray(state.agents)) {
      continue
    }
    hasTeam = true
    for (const agent of state.agents) {
      if (!isRecord(agent)) {
        continue
      }
      members += 1
      if (agent.state === 'working') {
        working += 1
      } else if (agent.state === 'waiting') {
        needsYou += 1
      }
    }
  }
  return hasTeam ? { members, working, needsYou } : null
}

/** "4 members · 2 working"; the working part is left out while nobody works. */
export function hostTeamLineText(line: HostTeamLine): string {
  const members = line.members === 1 ? '1 member' : `${line.members} members`
  return line.working > 0 ? `${members} · ${line.working} working` : members
}
