// Mirrors MOBILE_PLANE_BOARD_WRITES_RUNTIME_CAPABILITY in src/shared/protocol-version.ts.
// Hosts that predate it allowlist only plane.updateWorkItem for the phone, so a
// create is refused at dispatch; the board hides its write UI unless this is advertised.
export const MOBILE_PLANE_BOARD_WRITES_CAPABILITY = 'mobile.plane-board.writes.v1'

// Mirrors MOBILE_PLANE_BOARD_MEMBERS_RUNTIME_CAPABILITY. Hosts lab.52-54 advertise
// writes.v1 and still refuse plane.listMembers, so the assignee picker keys on this alone.
export const MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY = 'mobile.plane-board.members.v1'

export function isPlaneBoardWritableByHost(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(MOBILE_PLANE_BOARD_WRITES_CAPABILITY) === true
}

export function arePlaneMembersListableByHost(
  capabilities: readonly string[] | undefined
): boolean {
  return capabilities?.includes(MOBILE_PLANE_BOARD_MEMBERS_CAPABILITY) === true
}
