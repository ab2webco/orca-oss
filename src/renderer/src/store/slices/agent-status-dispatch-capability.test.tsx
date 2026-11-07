import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({
  scheduleRuntimeGraphSync: vi.fn()
}))
vi.mock('@/components/terminal-pane/pty-transport', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))
vi.mock('@/components/terminal-pane/shutdown-buffer-captures', () => ({
  shutdownBufferCaptures: vi.fn()
}))

// @ts-expect-error -- minimal preload API stub for the slice's IPC writes
globalThis.window = { api: {} }

import { makePaneKey } from '../../../../shared/stable-pane-id'
import DashboardAgentRow from '../../components/dashboard/DashboardAgentRow'
import { TooltipProvider } from '../../components/ui/tooltip'
import {
  getActivityThreadStatusPreview,
  getActivityThreadTaskTitle
} from '../../lib/activity-thread-display'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

const CAPABILITY = `dcap_${'B'.repeat(43)}`
// The three ways a capability reaches text: a spaced flag, an `=` flag and a bare token.
const SEEDED = `--dispatch-capability ${CAPABILITY} --dispatch-capability=${CAPABILITY} ${CAPABILITY}`
const SHOWN = '--dispatch-capability [redacted] --dispatch-capability=[redacted] [redacted]'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'

function seededStore() {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      repo1: [makeWorktree({ id: 'wt-1', repoId: 'repo1', path: '/path/wt-1' })]
    },
    tabsByWorktree: { 'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })] }
  })
  return store
}

// Why the store and not a component: every surface below reads the entry the setter wrote.
function seedWorkingAgent() {
  const store = seededStore()
  const paneKey = makePaneKey('tab-1', LEAF_ID)
  // Why unnormalized: Command Code's typed-prompt seed reaches the setter without the payload parser.
  store.getState().setAgentStatus(
    paneKey,
    {
      state: 'working',
      prompt: `orca orchestration send ${SEEDED}`,
      agentType: 'command-code',
      toolName: 'Bash',
      toolInput: `orca orchestration ask ${SEEDED}`,
      lastAssistantMessage: `Heartbeat sent with ${SEEDED}`
    },
    `zsh: orca send ${SEEDED}`
  )
  return { store, entry: store.getState().agentStatusByPaneKey[paneKey] }
}

describe('dispatch capability tokens in agent text', () => {
  it('the stored entry keeps the text and drops only the token', () => {
    const { entry } = seedWorkingAgent()
    expect(entry.prompt).toBe(`orca orchestration send ${SHOWN}`)
    expect(entry.toolInput).toBe(`orca orchestration ask ${SHOWN}`)
    expect(entry.lastAssistantMessage).toBe(`Heartbeat sent with ${SHOWN}`)
    expect(entry.terminalTitle).toBe(`zsh: orca send ${SHOWN}`)
    expect(JSON.stringify(entry)).not.toContain('dcap_')
  })

  it('activity thread title and preview show no token', () => {
    const { store, entry } = seedWorkingAgent()
    const tab = store.getState().tabsByWorktree['wt-1'][0]
    const title = getActivityThreadTaskTitle({ entry, tab, generatedTitlesEnabled: true })
    const preview = getActivityThreadStatusPreview(entry)
    expect(title).toContain('[redacted]')
    expect(preview).toBe(`Bash: orca orchestration ask ${SHOWN}`)
    expect(`${title} ${preview}`).not.toContain('dcap_')
  })

  it('a dashboard row shows no token', () => {
    const { store, entry } = seedWorkingAgent()
    const tab = store.getState().tabsByWorktree['wt-1'][0]
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <DashboardAgentRow
          agent={{
            paneKey: entry.paneKey,
            entry,
            tab,
            agentType: 'command-code',
            state: entry.state,
            startedAt: entry.stateStartedAt
          }}
          onDismiss={vi.fn()}
          onActivate={vi.fn()}
          now={entry.updatedAt + 1_000}
          hideIdentityIcon
          hideExpand
        />
      </TooltipProvider>
    )
    expect(markup).toContain('[redacted]')
    expect(markup).not.toContain('dcap_')
  })

  it('a shell title naming the running command shows no token', () => {
    const store = seededStore()
    store.getState().updateTabTitle('tab-1', `orca send ${SEEDED}`)
    store.getState().setRuntimePaneTitle('tab-1', 1, `orca ask ${SEEDED}`)
    expect(store.getState().tabsByWorktree['wt-1'][0].title).toBe(`orca send ${SHOWN}`)
    expect(store.getState().runtimePaneTitlesByTabId['tab-1'][1]).toBe(`orca ask ${SHOWN}`)
  })
})
