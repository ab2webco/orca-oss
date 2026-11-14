type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const leadStatesOf = (states: readonly unknown[]): Rec[] =>
  states.filter(
    (state): state is Rec => isRecord(state) && state.role === 'lead' && Array.isArray(state.agents)
  )

/**
 * Who runs on one account across a host's lead game.state answers, matched by its id: "Lead" first
 * when the host names the lead's own account (an older host does not, so it is never guessed), then
 * the members.
 */
export function accountMemberNamesOf(
  states: readonly unknown[],
  provider: 'claude' | 'codex',
  account: { id: string }
): string[] {
  const runsHere = (value: unknown): boolean =>
    isRecord(value) && value.provider === provider && value.id === account.id
  const leads = leadStatesOf(states)
  const members = leads.flatMap((state) =>
    (state.agents as unknown[]).flatMap((agent) =>
      isRecord(agent) &&
      runsHere(agent.account) &&
      typeof agent.displayName === 'string' &&
      agent.displayName !== ''
        ? [agent.displayName]
        : []
    )
  )
  return leads.some((state) => runsHere(state.leadAccount)) ? ['Lead', ...members] : members
}
