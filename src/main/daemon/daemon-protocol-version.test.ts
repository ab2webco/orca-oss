import { describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION,
  AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION,
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION
} from './daemon-protocol-version'

describe('daemon protocol version', () => {
  it('ships claim and incarnation authority after startup-ingress generations', () => {
    // Why 27: the lab spent 26 on requireReattach before upstream spent 26 on
    // claim ops; a surviving lab daemon at 26 lacks the claim ops, so the lab
    // gates them at 27 (see daemon-protocol-version.ts).
    expect(PROTOCOL_VERSION).toBe(27)
    expect(AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION).toBe(27)
    expect(AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION).toBe(27)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1)
    )
  })
})
