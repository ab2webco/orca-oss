import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as fs from 'node:fs'

const stat = vi.hoisted(() => ({ line: '' }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  readFileSync: () => stat.line
}))

import { processRunState } from './process-run-state-test-harness'

describe.skipIf(process.platform !== 'linux')('processRunState while init reaps a zombie', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports the X state a zombie passes through on its way out as gone, not running', () => {
    vi.spyOn(process, 'kill').mockReturnValue(true)
    stat.line = '5977 (sleep) X 1 5976 5976 0 -1'
    expect(processRunState(5977)).toBe('gone')
    stat.line = '5977 (sleep) Z 1 5976 5976 0 -1'
    expect(processRunState(5977)).toBe('zombie')
    stat.line = '5977 (sleep) S 1 5976 5976 0 -1'
    expect(processRunState(5977)).toBe('running')
  })
})
