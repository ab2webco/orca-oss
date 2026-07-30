/**
 * ORCA-124: an account-directed (background-path) agent terminal restoring after
 * an update that crossed the daemon protocol boundary. Its PTY still lives in the
 * legacy daemon, so the restore must reach THAT adapter — not the fresh one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DaemonPtyRouter } from '../daemon/daemon-pty-router'
import type { DaemonPtyAdapter } from '../daemon/daemon-pty-adapter'
import type { PtySpawnOptions, PtySpawnResult } from '../providers/types'
import { requiresLiveClaudePtyReattach } from './live-claude-pty-reattach-requirement'
import {
  clearInjectedClaudePtyBinding,
  seedInjectedClaudePtyBindings
} from './injected-claude-pty-binding'
import {
  getLiveInjectedClaudePtyAccountId,
  isLiveSharedClaudePty
} from './live-pty-account-ownership'

const WORKER_SESSION_ID = 'repo1::/w/worker@@0a1b2c3d'
const WORKER_ACCOUNT_ID = 'acct_worker'

function createAdapter(label: string, sessions: string[]): DaemonPtyAdapter {
  return {
    spawn: vi.fn(async (opts: PtySpawnOptions): Promise<PtySpawnResult> => {
      const id = opts.sessionId ?? `${label}-new`
      if (!sessions.includes(id)) {
        sessions.push(id)
      }
      return { id }
    }),
    listProcesses: vi.fn(async () => sessions.map((id) => ({ id, cwd: '', title: label }))),
    hasPty: vi.fn((id: string) => sessions.includes(id)),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    dispose: vi.fn()
  } as unknown as DaemonPtyAdapter
}

/**
 * Why unmapped: `discoverLegacySessions()` is the only thing that maps a legacy
 * id, and `adapterFor()` falls back to `this.current` for anything it missed.
 */
function createRouterWithUnmappedLegacySession(): {
  router: DaemonPtyRouter
  currentSessions: string[]
  legacySessions: string[]
} {
  const currentSessions: string[] = []
  const legacySessions: string[] = [WORKER_SESSION_ID]
  const router = new DaemonPtyRouter({
    current: createAdapter('current', currentSessions),
    legacy: [createAdapter('legacy', legacySessions)]
  })
  return { router, currentSessions, legacySessions }
}

afterEach(() => {
  clearInjectedClaudePtyBinding(WORKER_SESSION_ID, null)
})

describe('restoring an account-directed Claude terminal across a daemon protocol crossing', () => {
  it('recognizes the seeded injected binding as a live session that must reattach', () => {
    seedInjectedClaudePtyBindings([{ sessionId: WORKER_SESSION_ID, accountId: WORKER_ACCOUNT_ID }])
    expect(
      requiresLiveClaudePtyReattach({
        isExistingSharedClaudeSession: isLiveSharedClaudePty(WORKER_SESSION_ID),
        existingInjectedAccountId: getLiveInjectedClaudePtyAccountId(WORKER_SESSION_ID)
      })
    ).toBe(true)
  })

  it('reattaches to the legacy daemon that still owns the worker PTY', async () => {
    const { router, currentSessions, legacySessions } = createRouterWithUnmappedLegacySession()
    const result = await router.spawn({
      cols: 120,
      rows: 40,
      cwd: '/w/worker',
      sessionId: WORKER_SESSION_ID,
      requireReattach: true
    })
    expect(result.id).toBe(WORKER_SESSION_ID)
    expect(legacySessions).toEqual([WORKER_SESSION_ID])
    // Why this is the whole bug: a fresh id here is the empty pane the user saw.
    expect(currentSessions).toEqual([])
  })

  it('silently mints an empty session on the new daemon without the reattach requirement', async () => {
    const { router, currentSessions, legacySessions } = createRouterWithUnmappedLegacySession()
    await router.spawn({
      cols: 120,
      rows: 40,
      cwd: '/w/worker',
      sessionId: WORKER_SESSION_ID
    })
    expect(currentSessions).toEqual([WORKER_SESSION_ID])
    // The real CLI keeps running in the legacy daemon, now unreachable.
    expect(legacySessions).toEqual([WORKER_SESSION_ID])
  })

  it('reports the session as unreattachable once no daemon hosts it', async () => {
    const router = new DaemonPtyRouter({
      current: createAdapter('current', []),
      legacy: [createAdapter('legacy', [])]
    })
    await expect(
      router.spawn({
        cols: 120,
        rows: 40,
        cwd: '/w/worker',
        sessionId: WORKER_SESSION_ID,
        requireReattach: true
      })
    ).rejects.toThrow('PTY_REQUIRED_REATTACH_UNAVAILABLE')
  })
})
