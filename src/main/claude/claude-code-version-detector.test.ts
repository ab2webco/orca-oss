import { describe, expect, it, vi } from 'vitest'
import { createClaudeCodeVersionDetector } from './claude-code-version-detector'

const clock = () => {
  let at = 0
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

describe('createClaudeCodeVersionDetector', () => {
  it('keeps a detected version for ten minutes', async () => {
    const time = clock()
    const run = vi.fn(async () => '2.1.322 (Claude Code)')
    const detect = createClaudeCodeVersionDetector({ run, now: time.now })

    expect(await detect()).toBe('2.1.322')
    time.advance(9 * 60_000)
    expect(await detect()).toBe('2.1.322')
    expect(run).toHaveBeenCalledTimes(1)
  })

  // Why (ORCA-1171): a `claude --version` that timed out under a restart's load was kept for ten
  // minutes, and every lead restored meanwhile came back without the game.
  it('asks again soon after a failed read instead of keeping it for ten minutes', async () => {
    const time = clock()
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValue('2.1.322 (Claude Code)')
    const detect = createClaudeCodeVersionDetector({ run, now: time.now })

    expect(await detect()).toBeNull()
    time.advance(30_000)
    expect(await detect()).toBe('2.1.322')
  })

  it('reads once for launches that ask at the same time', async () => {
    let answer: (stdout: string) => void = () => {}
    const run = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)))
    const detect = createClaudeCodeVersionDetector({ run, now: clock().now })

    const both = Promise.all([detect(), detect()])
    answer('2.1.322 (Claude Code)')
    expect(await both).toEqual(['2.1.322', '2.1.322'])
    expect(run).toHaveBeenCalledTimes(1)
  })
})
