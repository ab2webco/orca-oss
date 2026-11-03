import { expect, test } from './helpers/orca-app'
import { setTheme } from './helpers/settings-window'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { sizeWindow } from './helpers/game-showcase-demo-party'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site review clip: a note for the agent on a line of its own diff.
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
  const worktreeId = await attachRepoAndOpenTerminal(orcaPage, createShowcaseRepo())
  await ensureTerminalVisible(orcaPage)
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
      const absolutePath = `${worktree.path}${separator}src${separator}feed${separator}fetch-feed.ts`
      await window.api.fs.writeFile({ filePath: absolutePath, content })
      state.openDiff(
        wId,
        absolutePath,
        `src${separator}feed${separator}fetch-feed.ts`,
        'typescript',
        false
      )
    },
    { wId: worktreeId, content: AGENT_CHANGE }
  )

  const line = orcaPage
    .locator('.modified-in-monaco-diff-editor .view-lines .view-line')
    .filter({ hasText: NOTE_LINE })
    .first()
  await expect(line).toBeVisible({ timeout: 15_000 })
  await orcaPage.waitForTimeout(800)
  const clip = await showcaseClip(electronApp, testInfo, 'diff-note')
  await orcaPage.waitForTimeout(1_500)

  await line.hover()
  await orcaPage.waitForTimeout(600)
  const add = orcaPage.locator('.orca-diff-comment-add-btn').first()
  await expect(add).toBeVisible()
  await add.click()
  const input = orcaPage.getByPlaceholder('Add note for the AI')
  await expect(input).toBeVisible()
  await orcaPage.waitForTimeout(600)

  await input.pressSequentially(NOTE, { delay: 45 })
  await orcaPage.waitForTimeout(800)

  await orcaPage.getByRole('button', { name: 'Add note', exact: true }).click()
  const card = orcaPage.locator('.orca-diff-comment-card').filter({ hasText: NOTE })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await orcaPage.waitForTimeout(2_500)
  await clip.stop()
})
