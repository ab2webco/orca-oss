import type { Page } from '@stablyai/playwright-test'
import { ensureTerminalVisible, switchToWorktree } from './store'
import { waitForPaneIdentitySnapshot } from './terminal'

// Store seeds for the docs captures: an agent's status, the new-PR form and an open PR with checks.
export async function seedAgentStatus(
  page: Page,
  worktreeId: string,
  prompt: string,
  state: 'working' | 'waiting' | 'done' = 'working'
): Promise<void> {
  await switchToWorktree(page, worktreeId)
  await ensureTerminalVisible(page)
  const snapshot = await waitForPaneIdentitySnapshot(page, 1)
  const paneKey = `${snapshot.tabId}:${snapshot.panes[0]!.leafId}`
  await page.evaluate(
    ({ paneKey, prompt, state }) => {
      const now = Date.now()
      window
        .__store!.getState()
        .setAgentStatus(
          paneKey,
          { state, prompt, agentType: 'claude', lastAssistantMessage: prompt },
          prompt,
          { updatedAt: now, stateStartedAt: now - 1_000 }
        )
    },
    { paneKey, prompt, state }
  )
}

/** Stubs the hosted-review reads so Source Control offers a new pull request for `branch`. */
export async function seedPullRequestForm(
  page: Page,
  worktreeId: string,
  branch: string
): Promise<void> {
  await page.evaluate(
    ({ worktreeId, branch }) => {
      const store = window.__store!
      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === worktreeId)!
      // Why the cast: these stubs return just the fields Source Control reads, not whole results.
      store.setState(
        (current) =>
          ({
            repos: current.repos.map((repo) =>
              repo.id === worktree.repoId ? { ...repo, worktreeBaseRef: 'origin/main' } : repo
            ),
            gitStatusByWorktree: { ...current.gitStatusByWorktree, [worktreeId]: [] },
            remoteStatusesByWorktree: {
              ...current.remoteStatusesByWorktree,
              [worktreeId]: {
                hasUpstream: true,
                upstreamName: `origin/${branch}`,
                ahead: 0,
                behind: 0
              }
            },
            getHostedReviewCreationEligibility: async () => ({
              provider: 'github' as const,
              review: null,
              canCreate: true,
              blockedReason: null,
              nextAction: null,
              defaultBaseRef: 'origin/main',
              head: branch
            }),
            fetchHostedReviewForBranch: async () => null,
            setUpstreamStatus: () => undefined,
            fetchUpstreamStatus: async () => undefined,
            fetchPRForBranch: async () => null,
            fetchPRChecks: async () => [],
            fetchPRComments: async () => []
          }) as unknown as Partial<typeof current>
      )
      state.setActiveWorktree(worktreeId)
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('source-control')
    },
    { worktreeId, branch }
  )
}

type SeededChecks = { conclusion: 'success' | 'failure'; mergeStateStatus: 'BLOCKED' | 'CLEAN' }

/** Seeds a fictitious open PR (#42 on lumen/lumen-app) with three checks, then opens Checks. */
export async function seedOpenPullRequest(
  page: Page,
  worktreeId: string,
  branch: string,
  seeded: SeededChecks
): Promise<void> {
  await page.evaluate(
    ({ worktreeId, branch, seeded }) => {
      const store = window.__store!
      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === worktreeId)!
      const repo = state.repos.find((entry) => entry.id === worktree.repoId)!
      const pr = {
        number: 42,
        title: 'Cache the feed so it reads offline',
        state: 'open' as const,
        url: 'https://github.com/lumen/lumen-app/pull/42',
        checksStatus: seeded.conclusion,
        updatedAt: new Date().toISOString(),
        mergeable: 'MERGEABLE' as const,
        mergeStateStatus: seeded.mergeStateStatus,
        autoMergeAllowed: false,
        mergeMethodSettings: {
          defaultMethod: 'squash' as const,
          allowedMethods: { squash: true, merge: true, rebase: true }
        },
        prRepo: { owner: 'lumen', repo: 'lumen-app' }
      }
      const checks = ['build', 'lint', 'unit tests'].map((name) => ({
        name,
        status: 'completed' as const,
        conclusion: name === 'unit tests' ? seeded.conclusion : ('success' as const),
        url: null
      }))
      const entries = {
        [`${repo.id}::${branch}`]: { data: pr, fetchedAt: Date.now() },
        [`${repo.path}::${branch}`]: { data: pr, fetchedAt: Date.now() }
      }
      // Why the cast: these stubs return just the fields Checks reads, not whole results.
      store.setState(
        (current) =>
          ({
            prCache: { ...current.prCache, ...entries },
            gitStatusByWorktree: { ...current.gitStatusByWorktree, [worktreeId]: [] },
            remoteStatusesByWorktree: {
              ...current.remoteStatusesByWorktree,
              [worktreeId]: {
                hasUpstream: true,
                upstreamName: `origin/${branch}`,
                ahead: 0,
                behind: 0
              }
            },
            fetchPRForBranch: async (_repoPath: string, target: string) => {
              if (target !== branch) {
                return null
              }
              store.setState((next) => ({ prCache: { ...next.prCache, ...entries } }))
              return pr
            },
            fetchHostedReviewForBranch: async () => null,
            fetchPRChecks: async () => checks,
            fetchPRComments: async () => [],
            fetchUpstreamStatus: async () => undefined,
            setUpstreamStatus: () => undefined
          }) as unknown as Partial<typeof current>
      )
      state.setActiveWorktree(worktreeId)
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('checks')
    },
    { worktreeId, branch, seeded }
  )
}
