// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { flushSync } from 'react-dom'
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
let root: Root | null = null

function HookProbe({ tab }: { tab: TerminalTab }): null {
  useTabAgent(tab)
  return null
}

function tabWithTitle(title: string): TerminalTab {
  return {
    id: TAB_ID,
    ptyId: 'pty-1',
    worktreeId: 'wt-1',
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

describe('useTabAgent under a burst of synchronous commits', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true)
    useAppStore.setState({
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
      root?.render(createElement(HookProbe, { tab: tabWithTitle('✳ Claude Code') }))
    })

    // Why: after a worktree switch each title write is its own sync commit whose passive effects
    // React flushes inline; a no-op setState there left work pending on every one (crash #298).
    const retitleBurst = (): void => {
      for (let i = 0; i < 60; i++) {
        flushSync(() => {
          root?.render(createElement(HookProbe, { tab: tabWithTitle(`✳ Claude Code ${i}`) }))
        })
      }
    }
    expect(retitleBurst).not.toThrow()
  })
})
