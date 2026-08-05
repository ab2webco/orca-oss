// Why: daemons survive app updates, so wire behavior must be version-gated.
// Why 33: two numbering lineages met here, and 31 collided the same way 30 and 27 did. The lab
// claimed 26 for requireReattach and 27 for claim-ops + completion-process-inspection, then 30 to
// sit above upstream's 27 (a DIFFERENT feature set), 28 (permanent macOS preflight rejections,
// #9756) and 29 ('2031-unsubscribe' transient facts, #9993), then 31 for the merged daemon that
// carries both sets. Upstream independently spent 30 on bounded-NDJSON history seed transfer, 31 on
// stable-pane attach-only reattachment and 32 on the corrected snapshot serializer. A merged daemon
// implements both sets, so it must sit above both lineages — reusing 32 would leave a running
// lab-lineage 31 daemon indistinguishable from an upstream-lineage 31 one.
export const PROTOCOL_VERSION = 33
// Why 26: the lab's requireReattach wire flag landed on upstream 25; older daemons (including
// upstream 22-25) silently ignore it, so it needs its own gate.
export const REQUIRED_REATTACH_PROTOCOL_VERSION = 26
// Stays at upstream's 32: the lab shipped no 32, so a daemon reporting 32 is necessarily
// upstream-lineage and does carry the corrected serializer. Unambiguous, unlike the gates below.
export const SNAPSHOT_SERIALIZER_FIDELITY_DAEMON_PROTOCOL_VERSION = 32
// Why 33, not upstream's 31: a lab-lineage v31 daemon predates attach-only reattachment entirely,
// and both lineages share the daemon-v31.sock namespace, so 31 cannot prove support.
export const STABLE_PANE_ATTACH_ONLY_DAEMON_PROTOCOL_VERSION = 33
// Why 31, not upstream's 30: a lab-lineage v30 daemon has no startHistorySeedTransfer at all, and
// both lineages share the daemon-v30.sock namespace, so 30 cannot prove support. Both lineages
// carry it at 31; below that, oversized seeds degrade to an unseeded create.
export const HISTORY_SEED_TRANSFER_PROTOCOL_VERSION = 31
// Why 30, not upstream's 27: a lab v27 daemon answers inspectProcess but an upstream-lineage v27
// does not, and both share the daemon-v27.sock namespace, so the number alone cannot prove
// support. 30 is unambiguous — both lineages answer inspectProcess there — so anything below it is
// "cannot inspect" and gets routed through the fallback.
export const COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION = 30
export const GET_FOREGROUND_PROCESS_PROTOCOL_VERSION = 11
export const PTY_STARTUP_INGRESS_PROTOCOL_VERSION = 25
export const AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION = 27
export const AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION = 27
export const GIT_CREDENTIAL_GUARD_HOST_PROTOCOL_VERSION = 22
export const CLEAN_DISCONNECT_PROTOCOL_VERSION = 24
// Why (#9993): a gate-managed pane's bytes never reach the renderer, so main's
// transient facts are the only thing that can retire a 2031 subscription for it.
// Daemons before this version emit '2031-subscribe' but have no unsubscribe fact
// at all, so a TUI exiting while hidden would leave the subscription registered
// forever and the next theme flip would inject CSI 997 into whatever replaced it.
// Scan authority moves to the daemon only while a session is backgrounded, so the
// gate lives on backgrounding itself (setPtyBackgrounded): a pre-v29 daemon is
// never asked to thin, and main's scanner — which emits BOTH facts — stays
// authoritative over the whole stream. Filtering the subscribe fact alone would
// not help, because the visible-era subscription is registered by main.
// Stays at upstream's 29: the lab shipped no 29, so a daemon reporting 29 is
// necessarily upstream-lineage and does emit these facts. Unambiguous, unlike
// PROTOCOL_VERSION and the inspection gate, where both lineages reused a number.
export const MODE_2031_UNSUBSCRIBE_FACT_PROTOCOL_VERSION = 29
export const PREVIOUS_DAEMON_PROTOCOL_VERSIONS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32
] as const

export function supportsPtyStartupIngress(protocolVersion: number): boolean {
  return protocolVersion >= PTY_STARTUP_INGRESS_PROTOCOL_VERSION
}

export function supportsMode2031UnsubscribeFact(protocolVersion: number): boolean {
  return protocolVersion >= MODE_2031_UNSUBSCRIBE_FACT_PROTOCOL_VERSION
}
