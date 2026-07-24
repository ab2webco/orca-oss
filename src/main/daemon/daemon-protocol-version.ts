// Why: daemons survive app updates, so wire behavior must be version-gated.
// Why 28: the lab claimed 26 for requireReattach and 27 for the merged claim-ops +
// completion-process-inspection feature set; upstream then bumped to 28 to replace
// v26/v27 daemons that can retain permanent macOS preflight rejections (#9756). The
// merged 28 daemon implements both the lab and upstream feature sets.
export const PROTOCOL_VERSION = 28
// Why 26: the lab's requireReattach wire flag landed on upstream 25; older
// daemons (including upstream 22-25) silently ignore it, so it needs its own gate.
export const REQUIRED_REATTACH_PROTOCOL_VERSION = 26
export const COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION = 27
export const PTY_STARTUP_INGRESS_PROTOCOL_VERSION = 25
export const AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION = 27
export const AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION = 27
export const GIT_CREDENTIAL_GUARD_HOST_PROTOCOL_VERSION = 22
export const CLEAN_DISCONNECT_PROTOCOL_VERSION = 24
export const PREVIOUS_DAEMON_PROTOCOL_VERSIONS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27
] as const

export function supportsPtyStartupIngress(protocolVersion: number): boolean {
  return protocolVersion >= PTY_STARTUP_INGRESS_PROTOCOL_VERSION
}
