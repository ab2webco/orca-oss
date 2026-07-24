import { describe, expect, it } from 'vitest'
import { PREVIOUS_DAEMON_PROTOCOL_VERSIONS, PROTOCOL_VERSION } from './types'

describe('foreground-confirmation daemon protocol', () => {
  it('rejects daemons from before the fresh-confirmation RPC', () => {
    // Why 28: lab lineage — 26 was spent on requireReattach, 27 on the merged claim-ops +
    // completion-inspection set, then upstream bumped to 28 for preflight-cache replacement.
    expect(PROTOCOL_VERSION).toBe(28)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(19)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(22)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(23)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(24)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(25)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(26)
  })
})
