import { describe, expect, it, vi } from 'vitest'
import type { OrcaEvent } from '../../../shared/orca-events'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import type { MobileNotificationEvent, RuntimeWorktreeLifecycleEvent } from '../orca-runtime'
import {
  subscribeOrcaEvents,
  type AgentStatusSourceEvent,
  type OrcaEventSources
} from './orca-event-stream'

const LEAF = '11111111-1111-4111-8111-111111111111'

function listenerSlot<T>() {
  const listeners = new Set<(value: T) => void>()
  const subscribe = vi.fn((listener: (value: T) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  })
  const fire = (value: T): void => listeners.forEach((listener) => listener(value))
  return { subscribe, fire, count: () => listeners.size }
}

function snapshot(worktree: string, titles: string[]): RuntimeMobileSessionTabsResult {
  return {
    worktree,
    tabs: titles.map((title, index) => ({
      type: 'terminal',
      id: `tab${index}::${LEAF}`,
      title,
      parentTabId: `tab${index}`,
      leafId: LEAF,
      isActive: false
    }))
  } as RuntimeMobileSessionTabsResult
}

function makeSources(initialTabs: RuntimeMobileSessionTabsResult[] = []) {
  const agent = listenerSlot<AgentStatusSourceEvent>()
  const worktrees = listenerSlot<RuntimeWorktreeLifecycleEvent>()
  const notifications = listenerSlot<MobileNotificationEvent>()
  const tabs = listenerSlot<RuntimeMobileSessionTabsResult>()
  const sources: OrcaEventSources = {
    now: () => 42,
    handleForPaneKey: (paneKey) => `term(${paneKey})`,
    onAgentStatus: agent.subscribe,
    onWorktreeLifecycle: worktrees.subscribe,
    onNotificationDispatched: notifications.subscribe,
    listSessionTabs: vi.fn(async () => initialTabs),
    onSessionTabsChanged: tabs.subscribe
  }
  return { sources, agent, worktrees, notifications, tabs }
}

async function collect(sources: OrcaEventSources, names: string[] = [], worktreeId?: string) {
  const events: OrcaEvent[] = []
  const unsubscribe = await subscribeOrcaEvents(sources, { names, worktreeId }, (event) =>
    events.push(event)
  )
  return { events, unsubscribe }
}

describe('subscribeOrcaEvents', () => {
  it('streams agent status with the terminal handle and turn-ending detail', async () => {
    const { sources, agent } = makeSources()
    const { events } = await collect(sources)
    agent.fire({
      worktreeId: 'wt-1',
      paneKey: `tab0:${LEAF}`,
      receivedAt: 10,
      payload: { state: 'done', agentType: 'claude', interrupted: true }
    })
    expect(events).toEqual([
      {
        name: 'agent.status.changed',
        at: 10,
        worktreeId: 'wt-1',
        terminal: `term(tab0:${LEAF})`,
        payload: { paneKey: `tab0:${LEAF}`, state: 'done', agentType: 'claude', interrupted: true }
      }
    ])
  })

  it('streams worktree lifecycle and relayed notifications', async () => {
    const { sources, worktrees, notifications } = makeSources()
    const { events } = await collect(sources)
    worktrees.fire({ kind: 'created', worktreeId: 'wt-2', path: '/r/wt-2', branch: 'feat/x' })
    worktrees.fire({ kind: 'removed', worktreeId: 'wt-2', path: '/r/wt-2' })
    notifications.fire({
      type: 'notification',
      source: 'agent-task-complete',
      worktreeId: 'wt-2',
      title: 'Done',
      body: 'Agent finished'
    } as MobileNotificationEvent)
    expect(events.map((event) => [event.name, event.worktreeId, event.payload])).toEqual([
      ['worktree.created', 'wt-2', { path: '/r/wt-2', branch: 'feat/x' }],
      ['worktree.removed', 'wt-2', { path: '/r/wt-2' }],
      [
        'notification.dispatched',
        'wt-2',
        { source: 'agent-task-complete', title: 'Done', body: 'Agent finished' }
      ]
    ])
  })

  it('reports terminal changes against the tabs that existed when it subscribed', async () => {
    const { sources, tabs } = makeSources([snapshot('wt-1', ['zsh'])])
    const { events } = await collect(sources)
    tabs.fire(snapshot('wt-1', ['zsh', 'claude']))
    expect(events.map((event) => [event.name, event.payload])).toEqual([
      [
        'terminal.created',
        { tabId: 'tab1', leafId: LEAF, paneKey: `tab1:${LEAF}`, title: 'claude' }
      ]
    ])
  })

  it('only attaches the sources the requested names need', async () => {
    const { sources, agent, worktrees, notifications, tabs } = makeSources()
    await collect(sources, ['agent.*'])
    expect(agent.count()).toBe(1)
    expect(worktrees.count() + notifications.count() + tabs.count()).toBe(0)
    expect(sources.listSessionTabs).not.toHaveBeenCalled()
  })

  it('filters by worktree and detaches every source on unsubscribe', async () => {
    const { sources, agent, worktrees, notifications, tabs } = makeSources()
    const { events, unsubscribe } = await collect(sources, [], 'wt-1')
    worktrees.fire({ kind: 'created', worktreeId: 'wt-9', path: '/r/wt-9', branch: 'b' })
    expect(events).toEqual([])
    unsubscribe()
    expect(agent.count() + worktrees.count() + notifications.count() + tabs.count()).toBe(0)
  })
})
