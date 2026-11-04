// The kit's `test` with this suite's budget; every *.test.ts imports `test` from here, not the kit.
import { test as kitTest } from 'claude-code/testing'
import type { TestBody, TestOptions, TestRest } from 'claude-code/testing'

// Why: every test loads the mod's ~150 modules afresh (0.5-0.9 s here, ~1.2 s on the Windows
// queue runner, 5.9 s in its tail), against the kit's 5 s default; a hang still fails here.
export const TEST_TIMEOUT_MS = 30_000

export const test = (name: string, ...rest: TestRest): void => {
  const [options, body]: readonly [TestOptions, TestBody] = rest.length === 1 ? [{}, rest[0]] : rest
  kitTest(name, { timeoutMs: TEST_TIMEOUT_MS, ...options }, body)
}
