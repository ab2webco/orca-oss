import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import { setTheme } from './helpers/settings-window'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { sizeWindow } from './helpers/game-showcase-demo-party'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { glideAndClick, glideTo, movePointer, showPointer } from './helpers/showcase-pointer'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site review clip: a note for the agent on a line of its own diff.
const BASE = [
  "import { readCache, writeCache } from './feed-cache'",
  "import type { Story } from './story'",
  '',
  'const FEED_TIMEOUT_MS = 8_000',
  '',
  'export async function fetchFeed(url: string): Promise<Response> {',
  '  const response = await fetch(url)',
  "  if (!response.ok) throw new Error('feed unavailable')",
  '  return response',
  '}',
  '',
  'export async function loadStories(url: string): Promise<Story[]> {',
  '  try {',
  '    const response = await fetchFeed(url)',
  '    const stories = (await response.json()) as Story[]',
  '    await writeCache(stories)',
  '    return stories',
  '  } catch (error) {',
  '    const cached = await readCache()',
  '    if (cached) return cached',
  '    throw error',
  '  }',
  '}',
  '',
  'export function sortByDate(stories: Story[]): Story[] {',
  '  return [...stories].sort((a, b) => b.publishedAt - a.publishedAt)',
  '}',
  ''
].join('\n')
const AGENT_CHANGE = [
  "import { readCache, writeCache } from './feed-cache'",
  "import type { Story } from './story'",
  '',
  'const FEED_TIMEOUT_MS = 8_000',
  '',
  'export async function fetchFeed(url: string): Promise<Response> {',
  '  for (let attempt = 0; attempt < 5; attempt++) {',
  '    const signal = AbortSignal.timeout(FEED_TIMEOUT_MS)',
  '    const response = await fetch(url, { signal })',
  '    if (response.ok) return response',
  '    if (response.status < 500) break',
  '  }',
  "  throw new Error('feed unavailable')",
  '}',
  '',
  'export async function loadStories(url: string): Promise<Story[]> {',
  '  try {',
  '    const response = await fetchFeed(url)',
  '    const stories = dedupe((await response.json()) as Story[])',
  '    await writeCache(stories)',
  '    return sortByDate(stories)',
  '  } catch (error) {',
  '    const cached = await readCache()',
  '    if (cached) return sortByDate(cached)',
  '    throw error',
  '  }',
  '}',
  '',
  'export function dedupe(stories: Story[]): Story[] {',
  '  const seen = new Set<string>()',
  '  return stories.filter((story) => !seen.has(story.id) && seen.add(story.id))',
  '}',
  '',
  'export function sortByDate(stories: Story[]): Story[] {',
  '  return [...stories].sort((a, b) => b.publishedAt - a.publishedAt)',
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
  const repo = createShowcaseRepo()
  // Why a longer base: a five-line diff leaves most of the editor empty in the clip.
  writeFileSync(join(repo, 'src', 'feed', 'fetch-feed.ts'), BASE)
  execFileSync('git', ['-C', repo, 'commit', '-qam', 'Feed loading'])
  const worktreeId = await attachRepoAndOpenTerminal(orcaPage, repo)
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
  await showPointer(orcaPage, 1100, 760)
  const clip = await showcaseClip(electronApp, testInfo, 'diff-note')
  await orcaPage.waitForTimeout(1_500)

  await glideTo(orcaPage, line)
  await orcaPage.waitForTimeout(600)
  const add = orcaPage.locator('.orca-diff-comment-add-btn').first()
  await expect(add).toBeVisible()
  await glideAndClick(orcaPage, add, 15)
  const input = orcaPage.getByPlaceholder('Add note for the AI')
  await expect(input).toBeVisible()
  await orcaPage.waitForTimeout(600)

  await input.pressSequentially(NOTE, { delay: 45 })
  await orcaPage.waitForTimeout(800)

  await glideAndClick(orcaPage, orcaPage.getByRole('button', { name: 'Add note', exact: true }))
  const card = orcaPage.locator('.orca-diff-comment-card').filter({ hasText: NOTE })
  await expect(card).toBeVisible({ timeout: 15_000 })
  const cardBox = (await card.boundingBox())!
  await movePointer(orcaPage, cardBox.x + cardBox.width + 120, cardBox.y + cardBox.height / 2, 20)
  await orcaPage.waitForTimeout(1_500)
  await clip.stop()
})
