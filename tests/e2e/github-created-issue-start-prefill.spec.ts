import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'

const ISSUE_NUMBER = 6613
const ISSUE_TITLE = 'Start a newly created issue without losing its context'
const ISSUE_URL = `https://github.com/acme/repo/issues/${ISSUE_NUMBER}`
const fakeCliDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-created-issue-prefill-'))

const fakeGhSource = `
const args = process.argv.slice(2)
const joined = args.join(' ')
const issue = {
  number: ${ISSUE_NUMBER},
  title: ${JSON.stringify(ISSUE_TITLE)},
  state: 'open',
  html_url: ${JSON.stringify(ISSUE_URL)},
  labels: [],
  assignees: [],
  user: { login: 'e2e' },
  updated_at: '2026-07-22T12:00:00.000Z'
}

if (args[0] === 'auth' && args[1] === 'status') {
  console.error('github.com\\n  ✓ Logged in to github.com account e2e (GITHUB_TOKEN)')
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'user') {
  console.log(JSON.stringify({ login: 'e2e' }))
  process.exit(0)
}
if (args[0] === 'api' && args.includes('rate_limit')) {
  console.log(JSON.stringify({ resources: { core: { limit: 5000, remaining: 5000, reset: 0 }, graphql: { limit: 5000, remaining: 5000, reset: 0 }, search: { limit: 30, remaining: 30, reset: 0 } } }))
  process.exit(0)
}
if (args[0] === 'api' && args.includes('-X') && args.includes('POST') && joined.includes('repos/acme/repo/issues')) {
  console.log(JSON.stringify(issue))
  process.exit(0)
}
if (args[0] === 'api' && joined.includes('/labels')) {
  process.exit(0)
}
if (args[0] === 'api' && joined.includes('/assignees')) {
  process.exit(0)
}
if (args[0] === 'api' && joined.includes('repos/acme/repo/issues/${ISSUE_NUMBER}')) {
  console.log(JSON.stringify(issue))
  process.exit(0)
}
if (args[0] === 'api' && joined.includes('search/issues')) {
  console.log(JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }))
  process.exit(0)
}
if (args[0] === 'issue' && args[1] === 'list') {
  console.log('[]')
  process.exit(0)
}
if (args[0] === 'pr' && args[1] === 'list') {
  console.log('[]')
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'graphql') {
  console.log(JSON.stringify({ data: { search: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }))
  process.exit(0)
}
console.error('fake gh: unhandled ' + joined)
process.exit(1)
`

const fakeClaudeSource = `
const args = process.argv.slice(2)
process.stdout.write('E2E_CLAUDE_ARGV ' + JSON.stringify(args) + '\\n')
setInterval(() => {}, 60_000)
`

function installFakeCli(name: 'gh' | 'claude', source: string): void {
  if (process.platform === 'win32') {
    writeFileSync(path.join(fakeCliDir, `fake-${name}.js`), source)
    writeFileSync(
      path.join(fakeCliDir, `${name}.cmd`),
      `@echo off\r\nnode "%~dp0\\fake-${name}.js" %*\r\n`
    )
    return
  }
  const executable = path.join(fakeCliDir, name)
  writeFileSync(executable, `#!/usr/bin/env node\n${source}`)
  chmodSync(executable, 0o755)
}

installFakeCli('gh', fakeGhSource)
installFakeCli('claude', fakeClaudeSource)

const test = base.extend({
  launchEnv: [
    {
      PATH: `${fakeCliDir}${path.delimiter}${process.env.PATH ?? ''}`
    },
    { option: true }
  ]
})

test.afterAll(() => {
  rmSync(fakeCliDir, { recursive: true, force: true })
})

function configureGitHubRemote(repoPath: string): void {
  try {
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: repoPath, stdio: 'ignore' })
  } catch {
    // The disposable E2E repo does not have an origin on its first run.
  }
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/repo.git'], {
    cwd: repoPath,
    stdio: 'pipe'
  })
}

// Parked, not repaired — inherited from upstream, established by positive evidence rather than
// byte-identity (the spec exists in all three trees, so byte-identity decides nothing here).
// Measured: run 31665209057, the full E2E suite dispatched on upstream's own tip a63df91790 with
// no fork code in the tree — this case FAILS there. The same run also reds
// terminal-hidden-view-parking:467, repro-7732-gitlab-checks-job-details:116,
// floating-tab-rename:179, tab-create-entry-file-paths and orca-profiles ×2, confirming the
// earlier ORCA-203 classifications.
//
// Two traps this cost, both worth avoiding on the next attempt:
//   - Locally the case never reaches its real assertion: it dies ~100 lines earlier at
//     `expect(newIssueButton).toBeEnabled()` (:155) on ALL arms, including upstream and the fork
//     without the sync, because no store repo satisfies `getTaskEligibleRepos`
//     (`isGitRepoKind && (hasProjectRemoteIdentity || isProjectRemoteIdentityPending)`). A local
//     A/B therefore cannot decide this one — 3 interleaved rounds per arm proved only that.
//   - Upstream's tip cannot run its own E2E suite as-is: tests/e2e/terminal-macos-system-key-remap
//     imports './terminal-ime-pane-arena', which does not exist in that tree, so Playwright fails
//     at collection and every shard dies before a single spec runs. Drop that one spec to get a
//     measurable upstream arm.
//
// Unparked by: a fix upstream, or one in its own PR — not inside this sync (ORCA-203).
// Upstream's beforeAll below is the leading unpark candidate: it configures the remote
// this case needs before Electron launches. Verify on Linux CI in its own PR.
// Why: the remote must exist before Electron launches. `repos.add` probes the
// remote once, and a settled "no remote" both makes the repo ineligible for the
// tasks page (disabling "New GitHub issue") and suppresses re-probes for five
// minutes — so adding origin inside the test body can never recover.
test.beforeAll(({ testRepoPath }) => {
  configureGitHubRemote(testRepoPath)
})

// Keep this fixme through an upstream merge: upstream's copy has none, and its own tip reds
// this case, so resolving this file toward upstream re-imports a known failure un-parked.
test.fixme('starting a just-created GitHub issue launches Claude with its URL prefilled', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)

  await orcaPage.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const preparedWorkspace = state
      .allWorktrees()
      .find((worktree) => worktree.branch?.endsWith('e2e-secondary'))
    if (!preparedWorkspace) {
      throw new Error('Seeded secondary E2E worktree is not available')
    }
    // Why: this regression owns renderer-to-PTY command propagation, while the shared fixture already covers Git worktree creation.
    store.setState({
      createWorktree: async () => ({ worktree: preparedWorkspace })
    })
    await state.updateSettings({
      defaultTuiAgent: 'claude',
      disabledTuiAgents: [],
      ...(navigator.userAgent.includes('Windows') ? { terminalWindowsShell: 'git-bash' } : {})
    })
    store.getState().openTaskPage({ taskSource: 'github' })
  })

  const newIssueButton = orcaPage.getByRole('button', { name: 'New GitHub issue' })
  await expect(newIssueButton).toBeEnabled({ timeout: 15_000 })
  await newIssueButton.click()

  const createDialog = orcaPage.getByRole('dialog', { name: 'New GitHub issue' })
  await expect(createDialog).toBeVisible()
  await createDialog.getByPlaceholder('Short summary').fill(ISSUE_TITLE)
  await createDialog.getByRole('button', { name: 'Create issue' }).click()

  await expect(createDialog).toBeHidden({ timeout: 10_000 })
  await expect(orcaPage.getByRole('heading', { name: ISSUE_TITLE })).toBeVisible({
    timeout: 10_000
  })

  await orcaPage.getByRole('button', { name: 'Start workspace from issue' }).click()

  // Why: starting a GitHub issue now routes through the quick-create composer,
  // which carries the linked issue URL into the agent launch command on submit.
  const composer = orcaPage.getByRole('dialog', { name: /Create (workspace|worktree)/i })
  await expect(composer).toBeVisible({ timeout: 15_000 })
  const createWorkspaceButton = composer.getByRole('button', {
    name: /Create (workspace|worktree)/i
  })
  await expect(createWorkspaceButton).toBeEnabled({ timeout: 15_000 })
  await createWorkspaceButton.click()
  await expect(composer).toBeHidden({ timeout: 20_000 })

  let terminalText = ''
  await expect
    .poll(
      async () => {
        terminalText = await getTerminalContent(orcaPage, 12_000)
        return terminalText
      },
      {
        timeout: 30_000,
        message: 'Claude prefill command did not reach the active terminal buffer'
      }
    )
    .toContain('--prefill')
  expect(terminalText).toContain('--dangerously-skip-permissions')
  expect(terminalText).toContain('--prefill')
  expect(terminalText).toContain(ISSUE_URL)
  expect(terminalText).not.toMatch(/(?:^|\n)claude '--dangerously-skip-permissions'(?:\r?\n|$)/)
})
