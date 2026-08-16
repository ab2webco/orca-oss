import { describe, expect, it } from 'vitest'
import {
  collectRequiredTerminalTabIds,
  resolveTimedOutTerminalWorktreeSwitch,
  resolveTerminalWorktreeSwitch
} from './worktree-switch-readiness'

describe('terminal worktree switch readiness', () => {
  it('mounts the incoming worktree before reveal and waits for its visible terminal', () => {
    const pending = resolveTerminalWorktreeSwitch({
      activeWorktreeId: 'worktree-b',
      renderedActiveWorktreeId: 'worktree-a',
      requiredTerminalTabIds: new Set(['tab-b']),
      readyTerminalTabIds: new Set()
    })

    expect(pending.mountedWorktreeIds).toEqual(new Set(['worktree-a', 'worktree-b']))
    expect(pending.preparingIncomingWorktreeId).toBe('worktree-b')
    expect(pending.canReveal).toBe(false)

    const ready = resolveTerminalWorktreeSwitch({
      activeWorktreeId: 'worktree-b',
      renderedActiveWorktreeId: 'worktree-a',
      requiredTerminalTabIds: new Set(['tab-b']),
      readyTerminalTabIds: new Set(['tab-b'])
    })
    expect(ready.canReveal).toBe(true)
  })

  it('does not let stale readiness from an interrupted switch reveal the wrong worktree', () => {
    const switchToC = resolveTerminalWorktreeSwitch({
      activeWorktreeId: 'worktree-c',
      renderedActiveWorktreeId: 'worktree-a',
      requiredTerminalTabIds: new Set(['tab-c']),
      readyTerminalTabIds: new Set(['tab-b'])
    })

    expect(switchToC.mountedWorktreeIds).toEqual(new Set(['worktree-a', 'worktree-c']))
    expect(switchToC.canReveal).toBe(false)
  })

  it('reveals immediately when the incoming surface has no terminal requirement', () => {
    const editorSwitch = resolveTerminalWorktreeSwitch({
      activeWorktreeId: 'worktree-b',
      renderedActiveWorktreeId: 'worktree-a',
      requiredTerminalTabIds: new Set(),
      readyTerminalTabIds: new Set()
    })

    expect(editorSwitch.canReveal).toBe(true)
  })

  it('waits for every visible split terminal but not editor groups', () => {
    expect(
      collectRequiredTerminalTabIds({
        activeTabType: 'terminal',
        activeTabId: 'terminal-a',
        rememberedActiveTabId: 'terminal-a',
        terminalTabs: [{ id: 'terminal-a' }, { id: 'terminal-b' }],
        unifiedTabs: [
          { id: 'unified-a', entityId: 'terminal-a', contentType: 'terminal' },
          { id: 'unified-b', entityId: 'terminal-b', contentType: 'terminal' },
          { id: 'editor', entityId: 'file-a', contentType: 'editor' }
        ],
        groups: [
          { activeTabId: 'unified-a' },
          { activeTabId: 'unified-b' },
          { activeTabId: 'editor' }
        ]
      })
    ).toEqual(new Set(['terminal-a', 'terminal-b']))
  })

  it('keeps legacy split terminal IDs required when unified tabs are absent', () => {
    expect(
      collectRequiredTerminalTabIds({
        activeTabType: 'terminal',
        activeTabId: 'terminal-a',
        rememberedActiveTabId: 'terminal-a',
        terminalTabs: [{ id: 'terminal-a' }],
        unifiedTabs: [],
        groups: [{ activeTabId: 'terminal-a' }]
      })
    ).toEqual(new Set(['terminal-a']))
  })

  it('cancels only the current timed-out preparation back to its outgoing worktree', () => {
    expect(resolveTimedOutTerminalWorktreeSwitch(2, 2, 'b', 'b', 'a')).toBe('a')
    expect(resolveTimedOutTerminalWorktreeSwitch(2, 3, 'b', 'c', 'a')).toBeNull()
  })
})
