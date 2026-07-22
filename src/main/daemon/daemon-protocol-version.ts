// Why: daemons survive app updates, so wire behavior must be version-gated.
// Why 27: the lab claimed 26 for requireReattach before upstream claimed 26 for
// agent-session claim/create ops. A surviving lab daemon reporting 26 lacks the
// claim ops, so the merged build advertises 27 and gates upstream's 26-features
// at 27 to keep old lab daemons safe.
export const PROTOCOL_VERSION = 27
// Why 26: the lab's requireReattach wire flag landed on upstream 25; older
// daemons (including upstream 22-25) silently ignore it, so it needs its own gate.
export const REQUIRED_REATTACH_PROTOCOL_VERSION = 26
export const PTY_STARTUP_INGRESS_PROTOCOL_VERSION = 25
export const AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION = 27
export const AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION = 27
export const GIT_CREDENTIAL_GUARD_HOST_PROTOCOL_VERSION = 22
export const CLEAN_DISCONNECT_PROTOCOL_VERSION = 24
export const PREVIOUS_DAEMON_PROTOCOL_VERSIONS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26
] as const

export function supportsPtyStartupIngress(protocolVersion: number): boolean {
  return protocolVersion >= PTY_STARTUP_INGRESS_PROTOCOL_VERSION
}
