import { describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION,
  AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION,
  COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION,
  GET_FOREGROUND_PROCESS_PROTOCOL_VERSION,
  HISTORY_SEED_TRANSFER_PROTOCOL_VERSION,
  MODE_2031_UNSUBSCRIBE_FACT_PROTOCOL_VERSION,
  SNAPSHOT_SERIALIZER_FIDELITY_DAEMON_PROTOCOL_VERSION,
  STABLE_PANE_ATTACH_ONLY_DAEMON_PROTOCOL_VERSION,
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION,
  supportsMode2031UnsubscribeFact
} from './daemon-protocol-version'

describe('daemon protocol version', () => {
  it('sits above both lineages only where the number is ambiguous', () => {
    expect(PROTOCOL_VERSION).toBe(33)
    // Both lineages reused 27, 30 and 31 for different feature sets, so only the merged
    // daemon can prove it carries both. Seed transfer is carried by both at 31, and
    // inspectProcess is answered by both lineages from 30 up.
    expect(HISTORY_SEED_TRANSFER_PROTOCOL_VERSION).toBe(31)
    expect(COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION).toBe(30)
    expect(STABLE_PANE_ATTACH_ONLY_DAEMON_PROTOCOL_VERSION).toBe(33)
    // Not bumped: the lab shipped no 29 or 32, so a daemon reporting either is
    // necessarily upstream-lineage and does carry the behavior. Raising them would
    // withhold the fix from a daemon that has it.
    expect(SNAPSHOT_SERIALIZER_FIDELITY_DAEMON_PROTOCOL_VERSION).toBe(32)
    expect(MODE_2031_UNSUBSCRIBE_FACT_PROTOCOL_VERSION).toBe(29)
    expect(GET_FOREGROUND_PROCESS_PROTOCOL_VERSION).toBe(11)
    expect(AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION).toBe(27)
    expect(AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION).toBe(27)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1)
    )
  })

  it('withholds 2031-unsubscribe support from daemons that never emitted it', () => {
    // Why (#9993): a daemon below the gate emits '2031-subscribe' with no way to
    // retract it, so scan authority must stay with main. 29 is the boundary, and
    // it survives an app update — the live hazard is 28 and below.
    expect(supportsMode2031UnsubscribeFact(PROTOCOL_VERSION)).toBe(true)
    expect(supportsMode2031UnsubscribeFact(29)).toBe(true)
    expect(supportsMode2031UnsubscribeFact(28)).toBe(false)
    for (const version of PREVIOUS_DAEMON_PROTOCOL_VERSIONS.filter((version) => version < 29)) {
      expect(supportsMode2031UnsubscribeFact(version)).toBe(false)
    }
  })
})
