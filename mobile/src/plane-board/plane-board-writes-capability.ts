// Mirrors MOBILE_PLANE_BOARD_WRITES_RUNTIME_CAPABILITY in src/shared/protocol-version.ts.
// Hosts that predate it allowlist only plane.updateWorkItem for the phone, so a
// create is refused at dispatch; the board hides its write UI unless this is advertised.
export const MOBILE_PLANE_BOARD_WRITES_CAPABILITY = 'mobile.plane-board.writes.v1'

export function isPlaneBoardWritableByHost(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(MOBILE_PLANE_BOARD_WRITES_CAPABILITY) === true
}
