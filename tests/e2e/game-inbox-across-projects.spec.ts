import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { expectPlaceholdersFit } from './helpers/placeholder-fit'
import { openTeamInbox } from './helpers/team-panel-inbox'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameOwnerQuestion } from '../../src/shared/orchestrator-game-owner-questions'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

function createOtherRepo(): string {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), 'orca-inbox-other-'))
  writeFileSync(path.join(repoPath, 'README.md'), 'other project\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath })
  execFileSync('git', ['add', '.'], { cwd: repoPath })
  execFileSync(
    'git',
    ['-c', 'user.name=Orca E2E', '-c', 'user.email=orca-e2e@example.com', 'commit', '-m', 'seed'],
    { cwd: repoPath }
  )
  return repoPath
}

type Dispatched = {
  source?: string
  repoLabel?: string
  ownerQuestion?: string
  gameInbox?: { environmentId: string | null; worktreeId: string | null }
}

// A question asked in a project the person is not looking at must still reach them (ORCA-940).
test('another project’s question is announced, counted, answered and opens the Inbox', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  const otherRepo = createOtherRepo()
  try {
    await waitForSessionReady(orcaPage)
    const activeWorktreeId = await waitForActiveWorktree(orcaPage)
    // Why stub in main: the test cannot see an OS banner or the dock, only what Orca asked for.
    await electronApp.evaluate(({ ipcMain }) => {
      const seen = globalThis as unknown as { __inbox?: { dispatched: unknown[]; badge: number[] } }
      seen.__inbox = { dispatched: [], badge: [] }
      ipcMain.removeHandler('notifications:dispatch')
      ipcMain.handle('notifications:dispatch', (_event, args) => {
        seen.__inbox?.dispatched.push(args)
        return { delivered: true }
      })
      ipcMain.removeHandler('notifications:setBadgeCount')
      ipcMain.handle('notifications:setBadgeCount', (_event, count: number) => {
        seen.__inbox?.badge.push(count)
      })
    })
    const recorded = () =>
      electronApp.evaluate(
        () =>
          (globalThis as unknown as { __inbox: { dispatched: Dispatched[]; badge: number[] } })
            .__inbox
      )

    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const added = await client.call<{ repo: { id: string; displayName: string } }>('repo.add', {
      path: otherRepo,
      kind: 'git'
    })
    const otherWorktreeId = `${added.result.repo.id}::${otherRepo}`
    const otherName = added.result.repo.displayName
    await orcaPage.evaluate(async () => {
      await window.__store?.getState().fetchRepos()
    })
    // The watcher rereads on focus; once read with nothing open, both questions below are new to it.
    await orcaPage.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(async () => (await recorded()).badge.at(-1)).toBe(0)

    const ask = (worktreeId: string, question: string, options?: string[]) =>
      client.call<{ question: GameOwnerQuestion }>('game.ownerAsk', {
        worktreeId,
        ticket: 'orca-940',
        question,
        ...(options ? { options } : {})
      })
    await ask(activeWorktreeId, 'Ship the arcade in lab.111?', ['Yes', 'Wait'])
    const other = await ask(otherWorktreeId, 'Rotate the billing API key tonight?', [
      'Rotate it',
      'Wait for Monday'
    ])

    await expect
      .poll(async () =>
        (await recorded()).dispatched
          .filter((one) => one.source === 'game-owner-question')
          .map((one) => `${one.repoLabel}: ${one.ownerQuestion}`)
          .sort()
      )
      .toEqual(
        [
          `${otherName}: Rotate the billing API key tonight?`,
          expect.stringMatching(/: Ship the arcade in lab\.111\?$/)
        ].sort()
      )
    await expect.poll(async () => (await recorded()).badge.at(-1)).toBe(2)

    const { inboxTab, inbox } = await openTeamInbox(orcaPage)
    await expect(inboxTab).toContainText('2')

    // The host names the worktree the click opens; the window must know it to switch to it.
    const target = (await recorded()).dispatched.find(
      (one) => one.repoLabel === otherName
    )?.gameInbox
    expect(target?.worktreeId).toBeTruthy()
    const firstName = await orcaPage.evaluate(
      async ({ repoId, firstWorktreeId }) => {
        await window.__store?.getState().fetchWorktrees(repoId)
        const firstRepoId = firstWorktreeId.split('::')[0]
        return window.__store?.getState().repos.find((repo) => repo.id === firstRepoId)?.displayName
      },
      { repoId: added.result.repo.id, firstWorktreeId: activeWorktreeId }
    )
    await expect
      .poll(() =>
        orcaPage.evaluate(
          (id) => Boolean(window.__store?.getState().getKnownWorktreeById(id)),
          target?.worktreeId ?? ''
        )
      )
      .toBe(true)

    // What a click on the notification sends the window: it opens that project and its Inbox.
    await electronApp.evaluate(({ BrowserWindow }, inbox) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('ui:openGameInbox', inbox)
    }, target)
    await expect(inboxTab).toHaveAttribute('aria-selected', 'true')
    await expect
      .poll(() => orcaPage.evaluate(() => window.__store?.getState().activeWorktreeId))
      .toBe(target?.worktreeId)
    // The project left behind is now the other one, listed under its name.
    await expect(inbox.getByRole('heading', { name: firstName ?? '' })).toBeVisible()
    await expect(inbox.locator('[data-game-owner-question]')).toHaveCount(2)

    for (const width of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await expectPlaceholdersFit(inbox, `at ${width}px ${theme}`)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`game-inbox-across-${width}-${theme}.png`)
        })
      }
    }
    await orcaPage.setViewportSize({ width: 1440, height: 900 })

    const otherCard = inbox.locator(`[data-game-owner-question="${other.result.question.id}"]`)
    await otherCard.getByRole('button', { name: 'Wait for Monday' }).click()
    await expect(otherCard).toHaveCount(0)
    const answered = await client.call<{ questions: GameOwnerQuestion[] }>('game.ownerQuestions', {
      worktreeId: otherWorktreeId,
      all: true
    })
    expect(
      answered.result.questions.find((one) => one.id === other.result.question.id)?.answer?.text
    ).toBe('Wait for Monday')
    await expect(inboxTab).toContainText('1')
    await expect.poll(async () => (await recorded()).badge.at(-1)).toBe(1)
  } finally {
    rmSync(otherRepo, { recursive: true, force: true })
  }
})
