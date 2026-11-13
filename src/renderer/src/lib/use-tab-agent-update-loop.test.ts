// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import { useTabAgent } from './use-tab-agent'

const initialAppState = useAppStore.getInitialState()
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const TAB_ID = 'tab-1'
const WORKTREE_ID = 'wt-1'
const RETITLE_COUNT = 60
let root: Root | null = null

function HookProbe({ tab }: { tab: TerminalTab }): null {
  useTabAgent(tab)
  return null
}

// Why: the tab reaches the hook from the store, as the tab bar passes it to SortableTab.
function StoreTabProbe(): ReactElement | null {
  const tab = useAppStore((s) => s.tabsByWorktree[WORKTREE_ID]?.[0])
  return tab ? createElement(HookProbe, { tab }) : null
}

function tabWithTitle(title: string): TerminalTab {
  return {
    id: TAB_ID,
    ptyId: 'pty-1',
    worktreeId: WORKTREE_ID,
    title,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function workingHook(paneKey: string): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    agentType: 'claude',
    paneKey,
    stateHistory: []
  }
}

describe('useTabAgent under a burst of tab-title store writes', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true)
    useAppStore.setState({
      tabsByWorktree: { [WORKTREE_ID]: [tabWithTitle('✳ Claude Code')] },
      terminalLayoutsByTabId: {
        [TAB_ID]: {
          root: null,
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'pty-1' }
        }
      },
      agentStatusByPaneKey: {
        [makePaneKey(TAB_ID, LEAF_ID)]: workingHook(makePaneKey(TAB_ID, LEAF_ID))
      }
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    useAppStore.setState(initialAppState, true)
  })

  it('does not trip React #185 when a live agent retitles its tab on every commit', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(StoreTabProbe))
    })

    // Why: one microtask per write gives each its own sync commit in one task, so the render a
    // no-op setState queues never runs between them and React counts every commit as nested.
    const retitleBurst = async (): Promise<number> => {
      let landed = 0
      for (let index = 0; index < RETITLE_COUNT; index += 1) {
        useAppStore.getState().updateTabTitle(TAB_ID, `✳ Claude Code ${index}`)
        await Promise.resolve()
        await Promise.resolve()
        landed += 1
      }
      return landed
    }
    await expect(retitleBurst()).resolves.toBe(RETITLE_COUNT)
  })
})
