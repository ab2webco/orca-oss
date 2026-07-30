import { expect, test } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const readmeRow = orcaPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(orcaPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  // Why: the find shortcut only opens search when the keydown target is inside
  // the editor, so wait for the Explorer focus handoff to actually land instead
  // of racing the editor's deferred auto-focus.
  await expect
    .poll(
      () =>
        orcaPage.evaluate(() => {
          const root = document.querySelector('.rich-markdown-editor')
          return Boolean(root && document.activeElement && root.contains(document.activeElement))
        }),
      { timeout: 10_000, message: 'explorer open never handed focus to the rich markdown editor' }
    )
    .toBe(true)
  await pressShortcut(orcaPage, 'f')

  await expect(
    orcaPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
