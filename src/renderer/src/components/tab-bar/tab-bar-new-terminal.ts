import { useAppStore } from '@/store'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { revealNewTerminalOwnerRow } from '@/lib/new-terminal-owner-reveal'
import {
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'

/** The tab bar's + terminal for the active workspace: paired runtime, lifted default, or a shell-specific tab. */
export async function openNewTerminalFromTabBar(
  worktreeId: string,
  shellOverride?: string
): Promise<void> {
  const state = useAppStore.getState()
  const targetGroupId =
    state.activeGroupIdByWorktree[worktreeId] ?? state.groupsByWorktree[worktreeId]?.[0]?.id
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
    await createWebRuntimeSessionTerminal({
      worktreeId,
      environmentId: runtimeEnvironmentId,
      targetGroupId,
      command: shellOverride,
      activate: true
    })
    revealNewTerminalOwnerRow(state, worktreeId)
    return
  }
  if (!shellOverride && targetGroupId) {
    await state.openNewTerminalTabInActiveWorkspace(targetGroupId)
    return
  }
  const newTab = state.createTab(worktreeId, undefined, shellOverride)
  revealNewTerminalOwnerRow(state, worktreeId)
  state.setActiveTabType('terminal')
  // Why: persist tab-bar order with the new terminal appended; else reconcileOrder falls back to terminals-first and jumps it to index 0 before editor tabs.
  const latest = useAppStore.getState()
  const termIds = (latest.tabsByWorktree[worktreeId] ?? []).map((t) => t.id)
  const editorIds = latest.openFiles.filter((f) => f.worktreeId === worktreeId).map((f) => f.id)
  const browserIds = (latest.browserTabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
  const validIds = new Set([...termIds, ...editorIds, ...browserIds])
  const base = (latest.tabBarOrderByWorktree[worktreeId] ?? []).filter((id) => validIds.has(id))
  const inBase = new Set(base)
  for (const id of [...termIds, ...editorIds, ...browserIds]) {
    if (!inBase.has(id)) {
      base.push(id)
      inBase.add(id)
    }
  }
  // The new tab is already in base via termIds; move it to the end
  latest.setTabBarOrder(worktreeId, [...base.filter((id) => id !== newTab.id), newTab.id])
  // Why: shell-specific creation still uses the legacy path; keep focus here until the lifted action accepts shell overrides.
  focusTerminalTabSurface(newTab.id)
}

/** A shell-specific terminal in one tab group: the paired runtime when it owns the workspace, else a local tab. */
export async function openShellTerminalInGroup(
  worktreeId: string,
  groupId: string,
  shellOverride: string
): Promise<void> {
  const state = useAppStore.getState()
  const environmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  const outcome = await createWebRuntimeSessionTerminal({
    worktreeId,
    environmentId,
    targetGroupId: groupId,
    command: shellOverride,
    activate: true
  })
  if (outcome.status === 'created' || isWebRuntimeSessionActive(environmentId)) {
    revealNewTerminalOwnerRow(state, worktreeId)
    return
  }
  const terminal = state.createTab(worktreeId, groupId, shellOverride)
  revealNewTerminalOwnerRow(state, worktreeId)
  state.setActiveTab(terminal.id)
  state.setActiveTabType('terminal')
  focusTerminalTabSurface(terminal.id)
}
