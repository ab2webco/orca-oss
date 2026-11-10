import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'

const WIDTHS = [1440, 768, 390, 320]
const COPY = {
  en: { two: '2 saved plays', one: '1 saved play', play: 'Play', offer: 'Perfect merge of #923' },
  es: {
    two: '2 partidas guardadas',
    one: '1 partida guardada',
    play: 'Jugar',
    offer: 'Merge perfecto de #923'
  }
} as const
type Language = keyof typeof COPY

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** Every width, theme and language, with the region checked to fit the panel. */
async function everyScreen(
  page: Page,
  testInfo: TestInfo,
  name: string,
  region: Locator,
  ready: (language: Language) => Promise<void>
): Promise<void> {
  for (const language of ['en', 'es'] as const) {
    await page.evaluate(
      (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
      language
    )
    await ready(language)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme)
        const spill = await region.evaluate(
          (node) =>
            node.getBoundingClientRect().right - node.parentElement!.getBoundingClientRect().right
        )
        const where = `${width}px ${theme} ${language}`
        expect(spill, `${name} spills out of the panel at ${where}`).toBeLessThanOrEqual(0)
        await page.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`team-arcade-${name}-${language}-${width}-${theme}.png`)
        })
      }
    }
  }
}

/** Earns one play with its offer in the project file the host already wrote for the lead. */
async function addEarnedOffer(dir: string, number: number): Promise<void> {
  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    const data = name.endsWith('.json') ? JSON.parse(await readFile(path, 'utf8')) : null
    if (Array.isArray(data?.arcadeOffers)) {
      const credits = (data.arcade?.credits ?? 0) + 1
      data.arcade = { credits, offer: { provider: 'github', number } }
      await writeFile(path, JSON.stringify(data, null, 2))
      return
    }
  }
  throw new Error('the host wrote no project file with paid offers')
}

// ORCA-1053: the Team tab spends the lead project's saved plays the host keeps. The credits come
// from game.arcade migrate, the path the mod uses for the offers its old countdown kept, and nothing
// is seeded into the panel. Only the offer is written into the host's file (see addEarnedOffer).
test('the Team tab shows the saved plays and the offer, and Play and Keep settle on the host', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))

  // Why a foreground process: a lead pane back at its shell is not a live lead.
  await client.call('terminal.send', {
    terminal: lead,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await expect
    .poll(async () => {
      const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
        terminalHandle: lead,
        project: 'e2e',
        label: 'Alfred'
      })
      return registered.result.registered
    })
    .toBe(true)
  await emitCodexHookStatus(await readHookEndpoint(electronApp), {
    paneKey: pane.paneKey,
    worktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })

  const paid = await client.call<{ paid: number; arcade: { credits: number } }>('game.arcade', {
    worktreeId,
    terminalHandle: lead,
    action: 'migrate',
    offers: ['merged ORCA-901 #901', 'merged ORCA-902 #902']
  })
  expect(paid.result).toMatchObject({ paid: 2, arcade: { credits: 2 } })

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const saved = panel.locator('[data-arcade-credits]')
  await expect(saved).toContainText(COPY.en.two, { timeout: 90_000 })
  // No perfect merge waits on the person, so no offer card.
  await expect(panel.locator('[data-arcade-offer]')).toHaveCount(0)

  await everyScreen(orcaPage, testInfo, 'saved', saved, async (language) => {
    await expect(saved).toContainText(COPY[language].two)
    await expect(saved.getByRole('button', { name: COPY[language].play })).toBeVisible()
  })

  // Play spends one credit on the host and opens the run in the center, beside the panel.
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await saved.getByRole('button', { name: COPY.en.play }).click()
  await expect(orcaPage.locator('[data-arcade-tab]').first()).toBeVisible({ timeout: 15_000 })
  await expect(saved).toContainText(COPY.en.one, { timeout: 15_000 })
  const left = await client.call<{ arcade: { credits: number } }>('game.arcade', {
    worktreeId,
    terminalHandle: lead
  })
  expect(left.result.arcade.credits).toBe(1)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('team-arcade-played-en-1440.png')
  })

  // Why the file: the host earns an offer only from its own provider read of a merged review, which
  // has no seam an E2E can stub, so the earned offer goes into the host's own project file.
  await addEarnedOffer(join(userDataDir, 'orchestrator-game-history'), 923)
  const offer = panel.locator('[data-arcade-offer]')
  await expect(offer).toContainText(COPY.en.offer, { timeout: 45_000 })
  await everyScreen(orcaPage, testInfo, 'offer', offer, async (language) => {
    await expect(offer).toContainText(COPY[language].offer)
  })
  // Keep saves the play: the card goes and the count shows the two plays now saved.
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await offer.getByRole('button', { name: 'Keep' }).click()
  await expect(offer).toHaveCount(0, { timeout: 15_000 })
  await expect(saved).toContainText(COPY.en.two, { timeout: 15_000 })

  // The panel's arcade setting hides the saved plays; the host keeps them.
  await orcaPage.evaluate(async () => {
    const store = window.__store!.getState()
    const game = store.settings?.orchestratorGame ?? {}
    await store.updateSettings({
      orchestratorGame: { ...game, panel: { ...game.panel, arcade: false } }
    } as never)
  })
  await expect(saved).toHaveCount(0)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('team-arcade-off-en-1440.png')
  })
})
