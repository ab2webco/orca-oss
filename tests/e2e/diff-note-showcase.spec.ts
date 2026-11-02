import { expect, test } from './helpers/orca-app'
import { setTheme } from './helpers/settings-window'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { showcaseFrame, sizeWindow } from './helpers/game-showcase-demo-party'

// Source frames for the README review GIF: a note for the agent on a line of its own diff.
const AGENT_CHANGE = [
  'export async function fetchFeed(url: string): Promise<Response> {',
  '  for (let attempt = 0; attempt < 5; attempt++) {',
  '    const response = await fetch(url)',
  '    if (response.ok) return response',
  '  }',
  "  throw new Error('feed unavailable')",
  '}',
  ''
].join('\n')
const NOTE_LINE = 'for (let attempt = 0; attempt < 5; attempt++)'
const NOTE = 'Back off between attempts (250 ms, doubling) instead of retrying at once.'

test('a reviewer adds a note for the agent on a line of its diff', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await sizeWindow(electronApp, 1440, 900)
  await setTheme(orcaPage, 'dark')
  await expect(orcaPage.getByText('Workspace board moved to the bottom bar')).toHaveCount(0, {
    timeout: 15_000
  })

  await orcaPage.evaluate(
    async ({ wId, content }) => {
      const state = window.__store!.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === wId)
      if (!worktree) {
        throw new Error('active worktree not found')
      }
      const separator = worktree.path.includes('\\') ? '\\' : '/'
      const absolutePath = `${worktree.path}${separator}src${separator}index.ts`
      await window.api.fs.writeFile({ filePath: absolutePath, content })
      state.openDiff(wId, absolutePath, `src${separator}index.ts`, 'typescript', false)
    },
    { wId: worktreeId, content: AGENT_CHANGE }
  )

  const line = orcaPage
    .locator('.modified-in-monaco-diff-editor .view-lines .view-line')
    .filter({ hasText: NOTE_LINE })
    .first()
  await expect(line).toBeVisible({ timeout: 15_000 })
  await showcaseFrame(orcaPage, testInfo, '01-diff.png')

  await line.hover()
  const add = orcaPage.locator('.orca-diff-comment-add-btn').first()
  await expect(add).toBeVisible()
  await add.click()
  const input = orcaPage.getByPlaceholder('Add note for the AI')
  await expect(input).toBeVisible()
  await showcaseFrame(orcaPage, testInfo, '02-popover.png')

  await input.pressSequentially(NOTE, { delay: 10 })
  await showcaseFrame(orcaPage, testInfo, '03-typed.png')

  await orcaPage.getByRole('button', { name: 'Add note', exact: true }).click()
  const card = orcaPage.locator('.orca-diff-comment-card').filter({ hasText: NOTE })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await showcaseFrame(orcaPage, testInfo, '04-note.png')
})
