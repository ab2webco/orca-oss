import type { AppState } from '@/store/types'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review-cache-identity'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import { getWslDistroFromPath } from '@/lib/local-preflight-context'
import { isWebClientLocation } from '@/lib/web-client-location'
import { canPinClaudeAccountToWorktree } from '@/lib/claude-account-runtime-filter'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import { buildWorktreeClaudeAccountChipModel } from '../sidebar/worktree-claude-account-chip-model'
import { getPromptCacheCountdownForPane } from '../sidebar/prompt-cache-timer-selection'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import type { Repo, Worktree } from '../../../../shared/types'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TeamSoloSession } from '../../../../shared/team-panel-activity-rows'
import type {
  TeamAccount,
  TeamHost,
  TeamPullRequest,
  TeamTicket
} from '../../../../shared/team-panel-model-types'

export type TeamSoloSessionsState = Pick<
  AppState,
  | 'agentStatusByPaneKey'
  | 'tabsByWorktree'
  | 'worktreesByRepo'
  | 'repos'
  | 'settings'
  | 'cacheTimerByKey'
  | 'hostedReviewCache'
  | 'workspacePortScan'
  | 'claudeAccountRoster'
  | 'runtimeEnvironments'
  | 'sshTargetLabels'
  | 'sshConnectionStates'
>

function hostOf(
  state: TeamSoloSessionsState,
  worktree: Worktree,
  repo: Repo | undefined
): TeamHost {
  const parsed = parseExecutionHostId(
    worktree.hostId ?? (repo ? getRepoExecutionHostId(repo) : null)
  )
  if (parsed?.kind === 'ssh') {
    const status = state.sshConnectionStates.get(parsed.targetId)?.status
    return {
      kind: 'remote',
      name: state.sshTargetLabels.get(parsed.targetId) ?? parsed.targetId,
      environmentId: null,
      reachable: status === undefined || status === 'connected'
    }
  }
  if (parsed?.kind === 'runtime') {
    return {
      kind: 'remote',
      name:
        state.runtimeEnvironments.find((one) => one.id === parsed.environmentId)?.name ??
        parsed.environmentId,
      environmentId: parsed.environmentId,
      reachable: true
    }
  }
  return { kind: 'local' }
}

function ticketOf(worktree: Worktree): TeamTicket | null {
  const plane = worktree.linkedPlaneWorkItem
  if (plane) {
    return {
      identifier: plane.identifier,
      title: null,
      url: plane.url ?? null,
      statusGroup: null
    }
  }
  if (worktree.linkedLinearIssue) {
    return {
      identifier: worktree.linkedLinearIssue,
      title: null,
      url: null,
      statusGroup: null
    }
  }
  return worktree.linkedIssue
    ? {
        identifier: `#${worktree.linkedIssue}`,
        title: null,
        url: null,
        statusGroup: null
      }
    : null
}

function pullRequestOf(
  state: TeamSoloSessionsState,
  worktree: Worktree,
  repo: Repo | undefined
): TeamPullRequest | null {
  const identity = getWorktreeGitIdentityDisplay(worktree)
  if (!repo || identity?.kind !== 'branch') {
    return null
  }
  const key = getHostedReviewCacheKey(
    repo.path,
    identity.branchName,
    state.settings,
    repo.id,
    repo.connectionId,
    repo.executionHostId,
    true
  )
  const review = state.hostedReviewCache[key]?.data
  if (!review || review.provider === 'unsupported') {
    return null
  }
  return {
    provider: review.provider,
    number: review.number,
    title: review.title,
    url: review.url,
    state: review.state,
    ci: review.status,
    verdict: null,
    perfectMerge: null
  }
}

function accountOf(
  state: TeamSoloSessionsState,
  entry: AgentStatusEntry,
  worktree: Worktree,
  repo: Repo | undefined
): TeamAccount | null {
  // Why: only Claude panes on a host Orca manages accounts for have a known account.
  if (
    entry.agentType !== 'claude' ||
    isWebClientLocation() ||
    !canPinClaudeAccountToWorktree(worktree, repo)
  ) {
    return null
  }
  const chip = buildWorktreeClaudeAccountChipModel({
    pinnedAccountId: worktree.claudeAccountId,
    wslDistro: getWslDistroFromPath(worktree.path),
    roster: state.claudeAccountRoster,
    systemDefaultLabel: ''
  })
  return chip?.label ? { provider: 'claude', email: chip.label, usedPercent: null } : null
}

function worktreeIdOf(state: TeamSoloSessionsState, entry: AgentStatusEntry): string | null {
  if (entry.worktreeId) {
    return entry.worktreeId
  }
  const tabId = parsePaneKey(entry.paneKey)?.tabId
  if (!tabId) {
    return null
  }
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

/** Every live agent pane with the facts the sidebar already holds for its workspace. */
export function teamSoloSessionsOf(state: TeamSoloSessionsState): TeamSoloSession[] {
  const worktrees = new Map<string, Worktree>()
  for (const list of Object.values(state.worktreesByRepo)) {
    for (const worktree of list) {
      worktrees.set(worktree.id, worktree)
    }
  }
  const ports = getWorkspacePortsByWorktreeId(state.workspacePortScan?.result)
  const cacheOn = state.settings?.promptCacheTimerEnabled ?? false
  const ttlMs = state.settings?.promptCacheTtlMs ?? 0
  return Object.values(state.agentStatusByPaneKey).flatMap((entry) => {
    const worktreeId = worktreeIdOf(state, entry)
    const worktree = worktreeId ? worktrees.get(worktreeId) : undefined
    if (!worktree) {
      return []
    }
    const repo = state.repos.find((one) => one.id === worktree.repoId)
    const cache = cacheOn
      ? getPromptCacheCountdownForPane(entry.paneKey, state.cacheTimerByKey, ttlMs)
      : null
    return [
      {
        entry,
        repoName: repo?.displayName ?? '',
        worktreeName: worktree.displayName,
        worktreeId: worktree.id,
        isPrimary: worktree.isMainWorktree === true,
        host: hostOf(state, worktree, repo),
        ticket: ticketOf(worktree),
        pr: pullRequestOf(state, worktree, repo),
        note: worktree.comment.trim() || null,
        ports: (ports.get(worktree.id) ?? []).map((one) => one.port),
        account: accountOf(state, entry, worktree, repo),
        cacheExpiresAt: cache ? cache.startedAt + cache.ttlMs : null,
        // Why null: Jev reaches Orca only through the game mod; a pane with no game has no path.
        advisor: null
      }
    ]
  })
}
