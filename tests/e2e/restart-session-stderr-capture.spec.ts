/**
 * Invariant: `session.launch({ onStderr })` hands the test every byte main wrote to stderr,
 * starting at spawn, not just what arrived after `electron.launch` returned (ORCA-1066).
 * Needs E2E: the loss is in how Playwright's launcher drains Electron's real stderr pipe.
 */

import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'

test('onStderr receives what main wrote before electron.launch returned', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  const session = createRestartSession(testInfo)
  try {
    let stderr = ''
    const { app } = await session.launch({
      onStderr: (chunk) => {
        stderr += chunk
      }
    })
    try {
      // Why this line: launch cannot resolve until Playwright has read it, so it always comes
      // before any listener attached after launch, like main's whenReady startup logs.
      expect(stderr).toMatch(/^Debugger listening on ws:\/\//m)
    } finally {
      await session.close(app)
    }
  } finally {
    await session.dispose()
  }
})
