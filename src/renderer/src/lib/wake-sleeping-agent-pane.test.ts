// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT,
  type WakeHibernatedAgentsWorktreeDetail
} from '@/constants/terminal'

type TestRecord = {
  worktreeId: string
  paneKey: string
  tabId?: string
  origin?: 'worktree-sleep' | 'quit' | 'live'
  restoreOnTabOpenOnly?: boolean
  providerSession: { key: string; id: string }
}

const launchSpy =
  vi.fn<
    (record: TestRecord, options?: { onSessionLaunched?: (tabId: string) => void }) => boolean
  >()
vi.mock('./sleeping-agent-session-launch', () => ({
  launchSleepingAgentSession: (
    record: TestRecord,
    options?: { onSessionLaunched?: (tabId: string) => void }
  ) => launchSpy(record, options)
}))
vi.mock('./sleeping-agent-pane-ownership', () => ({
  getProviderSessionClaimKey: (record: TestRecord) => `claim:${record.providerSession.id}`
}))
const mountSpy = vi.fn()
vi.mock('@/components/terminal/background-terminal-worktree-mount', () => ({
  requestBackgroundTerminalWorktreeMount: (detail: unknown) => mountSpy(detail)
}))

let sleepingRecords: Record<string, TestRecord> = {}
let tabsByWorktree: Record<string, { id: string }[]> = {}
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ sleepingAgentSessionsByPaneKey: sleepingRecords, tabsByWorktree })
  }
}))

import { wakeSleepingAgentPaneInBackground } from './wake-sleeping-agent-pane'

const record = (paneKey: string, overrides: Partial<TestRecord> = {}): TestRecord => ({
  worktreeId: 'wt-1',
  paneKey,
  tabId: paneKey.split(':')[0],
  origin: 'quit',
  providerSession: { key: 'session_id', id: `session-${paneKey}` },
  ...overrides
})

function onWake(handler: (detail: WakeHibernatedAgentsWorktreeDetail) => void): () => void {
  const listener = (event: Event): void =>
    handler((event as CustomEvent<WakeHibernatedAgentsWorktreeDetail>).detail)
  window.addEventListener(WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT, listener)
  return () => window.removeEventListener(WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT, listener)
}

beforeEach(() => {
  sleepingRecords = {}
  tabsByWorktree = {}
  launchSpy.mockReset()
  mountSpy.mockReset()
})

describe('wakeSleepingAgentPaneInBackground', () => {
  it('does nothing for a pane that is not asleep', () => {
    const seen: WakeHibernatedAgentsWorktreeDetail[] = []
    const stop = onWake((detail) => seen.push(detail))
    expect(wakeSleepingAgentPaneInBackground('tab-a:leaf-a')).toBe('not-sleeping')
    stop()
    expect(seen).toEqual([])
    expect(mountSpy).not.toHaveBeenCalled()
    expect(launchSpy).not.toHaveBeenCalled()
  })

  it('lets only the target pane wake in place, leaving its sleeping neighbours asleep', () => {
    sleepingRecords = {
      'tab-a:leaf-a': record('tab-a:leaf-a'),
      'tab-b:leaf-b': record('tab-b:leaf-b')
    }
    tabsByWorktree = { 'wt-1': [{ id: 'tab-a' }, { id: 'tab-b' }] }
    const seen: WakeHibernatedAgentsWorktreeDetail[] = []
    const stop = onWake((detail) => {
      seen.push(detail)
      // A mounted pane claims its session unless the dispatcher already did.
      for (const claim of ['claim:session-tab-a:leaf-a', 'claim:session-tab-b:leaf-b']) {
        if (!detail.wokenClaimKeys?.has(claim)) {
          detail.wokenClaimKeys?.add(claim)
          ;(detail as { woke?: string[] }).woke = [
            ...((detail as { woke?: string[] }).woke ?? []),
            claim
          ]
        }
      }
    })
    expect(wakeSleepingAgentPaneInBackground('tab-a:leaf-a')).toBe('woken')
    stop()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.worktreeId).toBe('wt-1')
    expect((seen[0] as { woke?: string[] }).woke).toEqual(['claim:session-tab-a:leaf-a'])
    expect(mountSpy).not.toHaveBeenCalled()
    expect(launchSpy).not.toHaveBeenCalled()
  })

  it('mounts only the pane tab after a restart, even one slept to restore on open', () => {
    sleepingRecords = {
      'tab-a:leaf-a': record('tab-a:leaf-a', { restoreOnTabOpenOnly: true }),
      'tab-b:leaf-b': record('tab-b:leaf-b')
    }
    tabsByWorktree = { 'wt-1': [{ id: 'tab-a' }, { id: 'tab-b' }] }
    expect(wakeSleepingAgentPaneInBackground('tab-a:leaf-a')).toBe('mounted')
    expect(mountSpy).toHaveBeenCalledExactlyOnceWith({ worktreeId: 'wt-1', tabIds: ['tab-a'] })
    expect(launchSpy).not.toHaveBeenCalled()
  })

  it('reopens a worktree-slept session in a fresh background tab and mounts that tab', () => {
    sleepingRecords = { 'tab-a:leaf-a': record('tab-a:leaf-a', { origin: 'worktree-sleep' }) }
    launchSpy.mockImplementation((_record, options) => {
      options?.onSessionLaunched?.('tab-new')
      return true
    })
    expect(wakeSleepingAgentPaneInBackground('tab-a:leaf-a')).toBe('launched')
    expect(launchSpy).toHaveBeenCalledExactlyOnceWith(
      sleepingRecords['tab-a:leaf-a'],
      expect.objectContaining({ suppressNavigation: true })
    )
    expect(mountSpy).toHaveBeenCalledExactlyOnceWith({ worktreeId: 'wt-1', tabIds: ['tab-new'] })
  })

  it('reopens a session whose tab is gone instead of leaving it asleep', () => {
    sleepingRecords = { 'tab-a:leaf-a': record('tab-a:leaf-a') }
    launchSpy.mockReturnValue(true)
    expect(wakeSleepingAgentPaneInBackground('tab-a:leaf-a')).toBe('launched')
    expect(launchSpy).toHaveBeenCalledOnce()
  })

  it('reports a session the agent cannot resume', () => {
    sleepingRecords = { 'tab-a:leaf-a': record('tab-a:leaf-a', { origin: 'worktree-sleep' }) }
    launchSpy.mockReturnValue(false)
    expect(wakeSleepingAgentPaneInBackground('tab-a:leaf-a')).toBe('failed')
    expect(mountSpy).not.toHaveBeenCalled()
  })
})
