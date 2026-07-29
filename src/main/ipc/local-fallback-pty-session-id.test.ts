import { describe, expect, it } from 'vitest'
import { mintLocalFallbackPtySessionId } from './local-fallback-pty-session-id'
import { parsePtySessionId } from '../../shared/pty-session-id-format'

// Why: isSafePtySessionId resolves against this root, so it must be shaped for
// the host platform or every id would read as an escape on Windows.
const USER_DATA = process.platform === 'win32' ? 'C:\\orca-user-data' : '/tmp/orca-user-data'

describe('mintLocalFallbackPtySessionId', () => {
  it.each([
    ['posix worktree', 'repo-1::/Users/me/work/wt-1'],
    ['windows worktree', 'repo-1::C:\\Users\\me\\work\\wt-1'],
    ['folder workspace instance', 'repo-1::/Users/me/checkout::workspace:11111111-2222']
  ])('mints an id that resolves back to the %s', (_label, worktreeId) => {
    const sessionId = mintLocalFallbackPtySessionId(worktreeId, USER_DATA)

    expect(sessionId).toBeDefined()
    expect(parsePtySessionId(sessionId!)).toEqual({ worktreeId })
  })

  it('mints a distinct id per call so two panes of one worktree never collide', () => {
    const worktreeId = 'repo-1::/Users/me/work/wt-1'

    expect(mintLocalFallbackPtySessionId(worktreeId, USER_DATA)).not.toBe(
      mintLocalFallbackPtySessionId(worktreeId, USER_DATA)
    )
  })

  it.each([
    ['no worktree id', undefined],
    ['blank worktree id', '   ']
  ])('returns undefined for %s so the provider allocates its own', (_label, worktreeId) => {
    expect(mintLocalFallbackPtySessionId(worktreeId, USER_DATA)).toBeUndefined()
  })

  it('refuses a worktree id that would escape the user data root', () => {
    expect(
      mintLocalFallbackPtySessionId('repo-1::../../../../etc/orca-escape', USER_DATA)
    ).toBeUndefined()
  })

  it('refuses a worktree id carrying a NUL truncation attempt', () => {
    expect(mintLocalFallbackPtySessionId('repo-1::/tmp/wt\0/etc', USER_DATA)).toBeUndefined()
  })
})
