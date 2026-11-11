/** The project's lead as the + menu sees it; both inputs are already scoped to the active worktree's project. */
export type NewTabTeamMenuState =
  | { kind: 'no-team' }
  | { kind: 'lead-live'; leadName: string; leadPaneKey: string }
  | { kind: 'lead-closed'; leadAccountLabel: string | null }

export type NewTabTeamMenuInput = {
  liveLead: { name: string; paneKey: string } | null
  // Why 'unknown': a host older than ORCA-717 cannot list stored leads, so Reopen is never offered on a guess.
  storedLead: { accountLabel: string | null } | null | 'unknown'
}

export function newTabTeamMenuStateOf(input: NewTabTeamMenuInput): NewTabTeamMenuState {
  if (input.liveLead) {
    return { kind: 'lead-live', leadName: input.liveLead.name, leadPaneKey: input.liveLead.paneKey }
  }
  if (input.storedLead && input.storedLead !== 'unknown') {
    return { kind: 'lead-closed', leadAccountLabel: input.storedLead.accountLabel }
  }
  return { kind: 'no-team' }
}
