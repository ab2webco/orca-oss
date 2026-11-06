import { rm } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, screenRows, startGameBand } from './helpers/orchestrator-game-band'
import { startMessagesApi } from './helpers/showcase-messages-api'

// ORCA-1047: a reply drawn by the orca-game mod inside a real Claude Code copies as plain text. The
// mod heads it with one text row and frames nothing, so a selection of its body is the same text
// Claude Code alone draws, which `/quest off` shows in place.
const WIDTHS = [1440, 768, 390, 320]
// Box drawing and block elements: any frame, rule or bar a mod could draw around a message.
const BOX_CHARACTERS = /[─-▟]/

type Words = { status: string; next: string; answer: string; ask: string; asks: string }
const WORDS: Record<'en' | 'es', Words> = {
  en: {
    status: 'How is the build?',
    next: 'What now?',
    answer: 'The tests pass and the build is green. PR 924 is still in review.',
    ask: 'Everything is ready to publish.\n\nShall I open the PR?',
    asks: 'asks you'
  },
  es: {
    status: '¿Cómo va el build?',
    next: '¿Y ahora?',
    answer: 'Los tests pasan y el build está en verde. El PR 924 sigue en revisión.',
    ask: 'Todo está listo para publicar.\n\n¿Abro el PR?',
    asks: 'te pregunta'
  }
}

const stateOf = (role: 'lead' | 'member', locale: 'en' | 'es') => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: {
    id: 'demo-wt-1047',
    path: '/work/lumen-1047',
    branch: 'feat/lum-1047',
    displayName: role === 'member' ? 'Castillo · LUM-1047 Message copy' : 'lumen'
  },
  agents: [
    {
      paneKey: 'demo-lead',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  lead: { autostart: false, cap: 4, label: 'Atlas' },
  role,
  locale
})

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function closeSidebars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
}

// Why: newer Claude Code builds mark a reply with ⏺ where older ones drew ●.
const rowsOf = async (page: Page): Promise<string[]> =>
  (await screenRows(page)).map((row) => row.replace(/^⏺ /, '● '))

const screenOf = async (page: Page): Promise<string> => (await rowsOf(page)).join('\n')

/** The words of the message that starts with `● first`, joined across its wrapped rows. */
function messageWordsOf(rows: string[], first: string): string {
  const from = rows.findIndex((row) => row.startsWith(`● ${first}`))
  if (from === -1) {
    return ''
  }
  // Why blank rows count: a paragraph break inside the reply is an empty row.
  const end = rows.findIndex((row, at) => at > from && row !== '' && !row.startsWith('  '))
  return rows
    .slice(from, end === -1 ? undefined : end)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Waits for a repaint to finish: two equal reads that hold every word of both replies. Why: a
 * resize repaints the transcript, and a capture taken mid-repaint shows rows that are half drawn.
 */
async function waitForWholeReplies(page: Page, words: Words): Promise<void> {
  const answerFirst = words.answer.split(' ')[0]!
  const askFirst = words.ask.split(' ')[0]!
  let before = ''
  await expect
    .poll(
      async () => {
        const rows = await rowsOf(page)
        const now = rows.join('\n')
        const isSteady = now === before
        before = now
        const shown = [messageWordsOf(rows, answerFirst), messageWordsOf(rows, askFirst)]
        return isSteady ? shown : null
      },
      { timeout: 20_000, intervals: [500], message: 'a reply lost words or kept repainting' }
    )
    .toEqual([`● ${words.answer}`, `● ${words.ask.replace(/\s+/g, ' ')}`])
}

async function ask(page: Page, prompt: string, isDone: (screen: string) => boolean): Promise<void> {
  await page.keyboard.type(prompt)
  // Why retried: the first Enter can land before the prompt takes the typed text.
  await expect
    .poll(
      async () => {
        const isAnswered = isDone(await screenOf(page))
        if (!isAnswered) {
          await page.keyboard.press('Enter')
        }
        return isAnswered
      },
      { timeout: 60_000, intervals: [3_000], message: `no reply to "${prompt}"` }
    )
    .toBe(true)
}

/**
 * Selects visible rows `from` to `to` whole and reads what Orca's copy takes: the terminal's
 * selection. Why not a Shift drag: Claude Code 2.1.319 leaves xterm no selection from one.
 */
async function copyRows(page: Page, from: number, to: number): Promise<string> {
  return page.evaluate(
    ([first, last]) => {
      for (const manager of window.__paneManagers?.values() ?? []) {
        const terminal = manager.getActivePane?.()?.terminal
        if (!terminal) {
          continue
        }
        const top = terminal.buffer.active.viewportY
        terminal.selectLines(top + first, top + last)
        const selection = terminal.getSelection()
        terminal.clearSelection()
        return selection
      }
      return ''
    },
    [from, to] as const
  )
}

/** Copies from the row starting with `first` to the row holding `last`, as the screen is now. */
async function copyBetween(page: Page, first: string, last: string): Promise<string> {
  // Why settled: a resize or a mode switch redraws the transcript for a while.
  let rows: string[] = []
  await expect
    .poll(
      async () => {
        const before = rows.join('\n')
        rows = await rowsOf(page)
        return rows.join('\n') === before
      },
      { timeout: 20_000, intervals: [500] }
    )
    .toBe(true)
  const from = rows.findIndex((row) => row.trimStart().startsWith(first))
  const to = rows.findIndex((row, at) => at >= from && row.includes(last))
  expect(from, `no row starts with "${first}":\n${rows.join('\n')}`).toBeGreaterThan(-1)
  expect(to, `no row holds "${last}":\n${rows.join('\n')}`).toBeGreaterThan(-1)
  return copyRows(page, from, to)
}

const CASES = [
  { role: 'member' as const, theme: 'dark' as const, locale: 'es' as const, name: 'Castillo' },
  { role: 'member' as const, theme: 'light' as const, locale: 'en' as const, name: 'Castillo' },
  { role: 'lead' as const, theme: 'light' as const, locale: 'es' as const, name: 'Atlas' },
  { role: 'lead' as const, theme: 'dark' as const, locale: 'en' as const, name: 'Atlas' }
]

for (const one of CASES) {
  const label = `${one.role}-${one.theme}-${one.locale}`
  test(`a ${one.role} reply copies as plain text, headed by one row (${label})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(420_000)
    const words = WORDS[one.locale]
    const api = await startMessagesApi([
      { match: new RegExp(words.status.replace(/[?¿]/g, '.')), text: words.answer },
      { match: new RegExp(words.next.replace(/[?¿]/g, '.')), text: words.ask }
    ])
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: stateOf(one.role, one.locale),
      theme: one.theme,
      locale: one.locale,
      showcase: { apiUrl: api.url },
      // Why: ORCA_E2E_ORCA_GAME_DIR runs another build of the mod, as a before for the same checks.
      pluginDir: process.env.ORCA_E2E_ORCA_GAME_DIR || undefined,
      ...(one.role === 'member' ? { role: 'member' as const } : {})
    })
    const shoot = async (name: string) =>
      orcaPage.screenshot({
        path: testInfo.outputPath(`${label}-${name}.png`),
        animations: 'disabled'
      })
    const answerStart = words.answer.split(' ').slice(0, 3).join(' ')
    const question = words.ask.split('\n').at(-1)!
    try {
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'Claude never drew' })
        .toMatch(/❯|>/)
      await ask(orcaPage, words.status, (screen) => screen.includes(`${one.name} · `))
      await ask(orcaPage, words.next, (screen) => screen.includes(`${one.name} · ${words.asks}`))
      for (const width of WIDTHS) {
        await closeSidebars(orcaPage)
        await setWindowWidth(electronApp, orcaPage, width)
        await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain(one.name)
        await waitForWholeReplies(orcaPage, words)
        await shoot(`reply-${width}`)
      }
      await closeSidebars(orcaPage)
      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
      await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain(question)

      const headingText = `${one.name} · ${words.asks}`
      const rows = await rowsOf(orcaPage)
      expect(rows, 'the question heading is not at column 0').toContainEqual(
        expect.stringMatching(new RegExp(`^${headingText}`))
      )
      const copied = await copyBetween(orcaPage, headingText, question)
      expect(copied.split('\n')[0], JSON.stringify(copied)).toBe(headingText)
      expect(copied).not.toMatch(BOX_CHARACTERS)
      const askFirst = words.ask.split('\n')[0]!
      const body = await copyBetween(orcaPage, `● ${askFirst}`, question)
      const answer = await copyBetween(orcaPage, `● ${answerStart}`, answerStart)
      expect(answer).not.toMatch(BOX_CHARACTERS)

      // The same rows as Claude Code alone draws them: the body must not change by a cell.
      await ask(orcaPage, '/quest off', (screen) => !screen.includes(headingText))
      await shoot('native-1440')
      const nativeBody = await copyBetween(orcaPage, `● ${askFirst}`, question)
      const nativeAnswer = await copyBetween(orcaPage, `● ${answerStart}`, answerStart)
      expect(body).toBe(nativeBody)
      expect(answer).toBe(nativeAnswer)
      await testInfo.attach('copied', {
        body: `${copied}\n---\n${nativeBody}`,
        contentType: 'text/plain'
      })
    } finally {
      await api.close()
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
