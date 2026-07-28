import { describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION,
  AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION,
  COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION,
  GET_FOREGROUND_PROCESS_PROTOCOL_VERSION,
  MODE_2031_UNSUBSCRIBE_FACT_PROTOCOL_VERSION,
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION,
  supportsMode2031UnsubscribeFact
} from './daemon-protocol-version'

describe('daemon protocol version', () => {
<<<<<<< HEAD
  it('ships preflight-cache replacement after claim authority and completion inspection', () => {
    // Why 28: the lab spent 26 on requireReattach and 27 on the merged claim-ops +
    // completion-inspection feature set; upstream then bumped to 28 for preflight-cache
    // replacement (see daemon-protocol-version.ts). The merged daemon carries all of them.
    expect(PROTOCOL_VERSION).toBe(28)
    // Why 28: a merged-world v27 daemon cannot be trusted to implement inspectProcess
    // (lab v27 had it, upstream v27 did not, same socket namespace), so only the
    // current merged daemon is treated as inspection-capable.
    expect(COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION).toBe(28)
=======
  it('ships the 2031-unsubscribe fact after preflight-cache replacement', () => {
    expect(PROTOCOL_VERSION).toBe(29)
    expect(MODE_2031_UNSUBSCRIBE_FACT_PROTOCOL_VERSION).toBe(29)
    expect(COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION).toBe(27)
>>>>>>> origin/main
    expect(GET_FOREGROUND_PROCESS_PROTOCOL_VERSION).toBe(11)
    expect(AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION).toBe(27)
    expect(AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION).toBe(27)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toEqual(
      Array.from({ length: 28 }, (_, index) => index + 1)
    )
  })

  it('withholds 2031-unsubscribe support from every preserved older daemon', () => {
    // Why (#9993): v28 is what ships today, so a v28 daemon preserved across an app
    // update is the live hazard — it emits '2031-subscribe' with no way to retract it.
    // The boundary must sit at 29, not merely "recent enough".
    expect(supportsMode2031UnsubscribeFact(PROTOCOL_VERSION)).toBe(true)
    expect(supportsMode2031UnsubscribeFact(28)).toBe(false)
    for (const version of PREVIOUS_DAEMON_PROTOCOL_VERSIONS) {
      expect(supportsMode2031UnsubscribeFact(version)).toBe(false)
    }
  })
})
