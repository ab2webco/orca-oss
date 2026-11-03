import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from './helpers/orca-app'
import { setTheme } from './helpers/settings-window'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { sizeWindow } from './helpers/game-showcase-demo-party'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site design-mode clip: pick an element of the app under work in Orca's
// browser and leave the agent a note on it. The page is an invented "Lumen" landing page.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Lumen</title>
<style>
body{margin:0;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#0f1115;color:#e8eaf0}
nav{display:flex;justify-content:space-between;padding:20px 48px;color:#9aa3b5}
main{max-width:760px;margin:72px auto;padding:0 24px;text-align:center}
h1{font-size:44px;line-height:1.1;margin:0 0 16px}
p{color:#9aa3b5;font-size:18px}
.cta{display:inline-block;margin-top:24px;padding:12px 22px;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:56px;text-align:left}
.card{border:1px solid #262a33;border-radius:10px;padding:16px;background:#151821}
</style></head><body>
<nav><strong>Lumen</strong><span>Features · Pricing · Docs</span></nav>
<main>
<h1 id="headline">Read your feed, even offline</h1>
<p>Lumen keeps the last 200 stories on your phone, so the subway is no longer a dead zone.</p>
<a class="cta" id="cta">Start free</a>
<div class="cards"><div class="card">Offline cache</div><div class="card">Dark mode</div><div class="card">Share anywhere</div></div>
</main></body></html>`
const NOTE = 'Make the headline one line on desktop and use the brand blue for "offline".'

test('a reviewer annotates an element of the page for the agent', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(120_000)
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(PAGE)
  })
  // Why 5173: a dev server's usual port reads as the app under work; any free port still works.
  await new Promise<void>((resolve) => {
    server.once('error', () => server.listen(0, '127.0.0.1', resolve))
    server.listen(5173, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await attachRepoAndOpenTerminal(orcaPage, createShowcaseRepo())
    await ensureTerminalVisible(orcaPage)
    await sizeWindow(electronApp, 1440, 900)
    await setTheme(orcaPage, 'dark')
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar')).toHaveCount(0, {
      timeout: 15_000
    })
    await orcaPage.evaluate(
      ({ wId, url }) => {
        // Why: a closed right sidebar gives the page the room a reviewer would give it.
        window.__store!.getState().setRightSidebarOpen(false)
        window.__store!.getState().createBrowserTab(wId, url, { title: 'Lumen', activate: true })
      },
      { wId: worktreeId, url: `http://localhost:${port}/` }
    )
    const webview = orcaPage.locator('webview').first()
    await expect(webview).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(
        async () =>
          webview.evaluate((node) => (node as unknown as { getTitle(): string }).getTitle()),
        {
          timeout: 30_000
        }
      )
      .toBe('Lumen')
    // Why: a guest laid out wider than its box draws the page cut off and misplaces every click.
    await expect
      .poll(async () => {
        const guestWidth = await webview.evaluate((node) =>
          (
            node as unknown as { executeJavaScript(code: string): Promise<number> }
          ).executeJavaScript('window.innerWidth')
        )
        const box = await webview.boundingBox()
        return Math.abs(guestWidth - (box?.width ?? 0)) <= 2
      })
      .toBe(true)
    // Why: a one-time feature tour opens over the toolbar on a fresh profile.
    const tour = orcaPage.getByRole('button', { name: 'Got it' })
    if (await tour.isVisible()) {
      await tour.click()
      await expect(tour).toHaveCount(0)
    }
    await orcaPage.waitForTimeout(800)
    const clip = await showcaseClip(electronApp, testInfo, 'design-mode')
    await orcaPage.waitForTimeout(1_500)

    await orcaPage.getByRole('button', { name: 'Annotate page element' }).click()
    // Why the guest's own geometry: the headline's box inside the page, offset by the webview's box.
    const headline = await webview.evaluate(async (node) => {
      const guest = node as unknown as { executeJavaScript(code: string): Promise<unknown> }
      return guest.executeJavaScript(
        'JSON.stringify(document.getElementById("headline").getBoundingClientRect())'
      )
    })
    const rect = JSON.parse(String(headline)) as {
      x: number
      y: number
      width: number
      height: number
    }
    const box = await webview.boundingBox()
    expect(box).not.toBeNull()
    const target = { x: box!.x + rect.x + rect.width / 2, y: box!.y + rect.y + rect.height / 2 }
    await orcaPage.mouse.move(target.x - 40, target.y - 30)
    await orcaPage.mouse.move(target.x, target.y, { steps: 30 })
    await orcaPage.waitForTimeout(900)

    await orcaPage.mouse.click(target.x, target.y)
    const comment = orcaPage.getByRole('textbox', { name: 'Annotation comment' })
    await expect(comment).toBeVisible({ timeout: 15_000 })
    await comment.pressSequentially(NOTE, { delay: 45 })
    await orcaPage.waitForTimeout(800)

    // Why the regex: the button's name carries its shortcut hint ("Add ⌘↵" on a Mac).
    await orcaPage.getByRole('button', { name: /^Add\b(?! Project| quick)/ }).click()
    await expect(comment).toHaveCount(0)
    await expect(
      orcaPage.getByRole('button', { name: 'Annotate page element' }).locator('span')
    ).toHaveText('1')
    await orcaPage.waitForTimeout(2_500)
    await clip.stop()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
