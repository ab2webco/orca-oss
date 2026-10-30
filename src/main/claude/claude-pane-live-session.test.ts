import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudePaneLiveSessions, claudePaneLiveSessionOf } from './claude-pane-live-session'

const ROOT = join('/data', 'claude-accounts')
const NOW = 1_000_000_000_000
const RESET_S = (NOW + 3_600_000) / 1000

describe("a Claude pane's live session (ORCA-907)", () => {
  it('names the managed account whose vault the running process reported, with its own windows', () => {
    const session = claudePaneLiveSessionOf({
      event: {
        configDir: join(ROOT, 'acct_bo', 'auth'),
        fiveHour: { used_percentage: 12, resets_at: RESET_S },
        sevenDay: { used_percentage: 100, resets_at: RESET_S }
      },
      managedRoot: ROOT,
      boundAccountId: 'acct_ana',
      now: NOW
    })
    expect(session.accountId).toBe('acct_bo')
    expect(session.boundAccountId).toBe('acct_ana')
    expect(session.limits).toEqual(
      expect.objectContaining({
        provider: 'claude',
        status: 'ok',
        session: expect.objectContaining({ usedPercent: 12 }),
        weekly: expect.objectContaining({ usedPercent: 100, resetsAt: NOW + 3_600_000 }),
        updatedAt: NOW
      })
    )
  })

  it('names no account for the shared home or a directory outside the managed vaults', () => {
    const of = (configDir: string | null) =>
      claudePaneLiveSessionOf({
        event: { configDir, fiveHour: null, sevenDay: { used_percentage: 5 } },
        managedRoot: ROOT,
        boundAccountId: null,
        now: NOW
      }).accountId
    expect(of(null)).toBeNull()
    expect(of(join('/home', 'dev', '.claude'))).toBeNull()
  })

  it('drops a report once the pane was switched to another account, until the new process reports', () => {
    const sessions = new ClaudePaneLiveSessions()
    const report = { accountId: 'acct_bo', boundAccountId: 'acct_ana', limits: null }
    sessions.note('pty-1', report)
    expect(sessions.of('pty-1', 'acct_ana')).toBe(report)
    expect(sessions.of('pty-1', 'acct_cy')).toBeNull()
    expect(sessions.of('pty-2', 'acct_ana')).toBeNull()
  })

  it('keeps a bounded number of panes, forgetting the least recently reported', () => {
    const sessions = new ClaudePaneLiveSessions(2)
    const report = { accountId: 'a', boundAccountId: null, limits: null }
    sessions.note('pty-1', report)
    sessions.note('pty-2', report)
    sessions.note('pty-1', report)
    sessions.note('pty-3', report)
    expect(sessions.of('pty-2', null)).toBeNull()
    expect(sessions.of('pty-1', null)).toBe(report)
    expect(sessions.of('pty-3', null)).toBe(report)
  })
})
