/**
 * ORCA-512: a targeted browser command aimed at a background page must not put
 * that page's guest on screen over what the user is looking at.
 *
 * The lease that makes a parked guest paintable flips its viewport shell from
 * `display: none` to `display: flex`. A MutationObserver on the shell records
 * every intermediate value, so a lease taken and released inside one command is
 * still visible to the assertions.
 */

import { test, expect } from './helpers/orca-app'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getActiveTabType,
  ensureTerminalVisible
} from './helpers/store'

type CreatedBrowserTab = {
  tabId: string
  pageId: string
}

type ViewState = {
  activeTabType: string | null
  groupActiveTabId: string | null
  activeBrowserTabId: string | null
  shellDisplay: string | null
  shellOpacity: string | null
  shellRect: { x: number; y: number; width: number; height: number } | null
}

type StyleHistory = {
  found: boolean
  sawFlex: boolean
  records: string[]
  finalStyle: string | null
}

type RuntimeCallResult = {
  ok: boolean
  error?: { code?: string; message?: string }
  result?: unknown
}

const PAGE_A_MARKER = 'PAGE-A-CYAN'
const PAGE_B_MARKER = 'PAGE-B-MAGENTA'
const PAGE_A_LABEL = 'BROWSER PAGE A'
const PAGE_B_LABEL = 'BROWSER PAGE B'
const SLOW_SENTINEL = 'SLOW-READ-B-DONE'

// Why: an unpainted guest that answered with empty strings would satisfy every
// "the view did not change" assertion, so the read must prove it saw B's DOM.
const IDENTITY_EXPRESSION = `JSON.stringify({
  marker: document.body.dataset.marker,
  title: document.title,
  path: location.pathname,
  heading: document.querySelector('#page-heading')?.textContent
})`

const identityOf = (marker: string, label: string, path: string): string =>
  JSON.stringify({ marker, title: label, path, heading: label })

async function startTwoColourServer(): Promise<{
  urlA: string
  urlB: string
  close: () => Promise<void>
}> {
  const body = (marker: string, background: string, label: string): string =>
    `<!doctype html><html><head><title>${label}</title><style>
       html,body{margin:0;padding:0;height:100%;background:${background};}
       body{display:flex;align-items:center;justify-content:center;
            font:700 72px/1.1 system-ui,sans-serif;color:#000;}
     </style></head><body data-marker="${marker}">
       <h1 id="page-heading">${label}</h1>
     </body></html>`

  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(
      pathname === '/b'
        ? body(PAGE_B_MARKER, '#ff00ff', PAGE_B_LABEL)
        : body(PAGE_A_MARKER, '#00ffff', PAGE_A_LABEL)
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    urlA: `http://127.0.0.1:${port}/a`,
    urlB: `http://127.0.0.1:${port}/b`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}

async function createBrowserTab(
  page: Page,
  worktreeId: string,
  url: string,
  title: string
): Promise<CreatedBrowserTab> {
  const created = await page.evaluate(
    ({ targetWorktreeId, targetUrl, targetTitle }) => {
      const store = window.__store
      if (!store) {
        return null
      }
      const tab = store
        .getState()
        .createBrowserTab(targetWorktreeId, targetUrl, { title: targetTitle, activate: true })
      return { tabId: tab.id, pageId: tab.activePageId ?? tab.id }
    },
    { targetWorktreeId: worktreeId, targetUrl: url, targetTitle: title }
  )
  expect(created, `browser tab ${title} was not created`).not.toBeNull()
  return created!
}

async function waitForGuestMarker(page: Page, tabId: string, marker: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (targetTabId) => {
          const slot = document.querySelector(`[data-browser-overlay-tab-id="${targetTabId}"]`)
          const webview = slot?.querySelector('webview') as Electron.WebviewTag | null
          if (!webview) {
            return null
          }
          try {
            return (await webview.executeJavaScript('document.body?.dataset?.marker ?? null')) as
              | string
              | null
          } catch {
            return null
          }
        }, tabId),
      { timeout: 30_000, message: `guest for ${tabId} never reported marker ${marker}` }
    )
    .toBe(marker)
}

async function readViewState(
  page: Page,
  worktreeId: string,
  backgroundPageId: string
): Promise<ViewState> {
  return page.evaluate(
    ({ targetWorktreeId, pageId }) => {
      const store = window.__store
      const state = store?.getState()
      const groups = state?.groupsByWorktree?.[targetWorktreeId] ?? []
      const activeGroupId = state?.activeGroupIdByWorktree?.[targetWorktreeId]
      const activeGroup =
        (activeGroupId
          ? groups.find((group: { id: string }) => group.id === activeGroupId)
          : undefined) ?? groups[0]
      const shell = document.querySelector(`[data-browser-page-viewport-id="${pageId}"]`)
      const shellStyle = shell ? getComputedStyle(shell) : null
      const rect = shell ? shell.getBoundingClientRect() : null
      return {
        activeTabType: state?.activeTabType ?? null,
        groupActiveTabId: (activeGroup as { activeTabId?: string | null })?.activeTabId ?? null,
        activeBrowserTabId: state?.activeBrowserTabIdByWorktree?.[targetWorktreeId] ?? null,
        shellDisplay: shellStyle?.display ?? null,
        shellOpacity: shellStyle?.opacity ?? null,
        shellRect: rect
          ? {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          : null
      }
    },
    { targetWorktreeId: worktreeId, pageId: backgroundPageId }
  )
}

/** Record every style-attribute value a page's viewport shell passes through. */
async function watchShellStyle(page: Page, pageId: string): Promise<boolean> {
  return page.evaluate((targetPageId) => {
    type Watcher = { records: string[]; observer: MutationObserver }
    const watchers = ((
      window as unknown as { __orcaShellWatchers?: Record<string, Watcher> }
    ).__orcaShellWatchers ??= {})
    watchers[targetPageId]?.observer.disconnect()
    const shell = document.querySelector(`[data-browser-page-viewport-id="${targetPageId}"]`)
    if (!shell) {
      return false
    }
    const records: string[] = []
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        records.push(mutation.oldValue ?? '')
      }
    })
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true
    })
    watchers[targetPageId] = { records, observer }
    return true
  }, pageId)
}

async function readShellStyleHistory(page: Page, pageId: string): Promise<StyleHistory> {
  return page.evaluate((targetPageId) => {
    const watchers = (window as unknown as { __orcaShellWatchers?: Record<string, unknown> })
      .__orcaShellWatchers as
      | Record<string, { records: string[]; observer: MutationObserver }>
      | undefined
    const watcher = watchers?.[targetPageId]
    const shell = document.querySelector(`[data-browser-page-viewport-id="${targetPageId}"]`)
    const finalStyle = shell?.getAttribute('style') ?? null
    const records = watcher ? [...watcher.records] : []
    const all = finalStyle === null ? records : [...records, finalStyle]
    return {
      found: Boolean(watcher),
      sawFlex: all.some((value) => /display:\s*flex/.test(value)),
      records: all,
      finalStyle
    }
  }, pageId)
}

async function callRuntime(
  page: Page,
  method: string,
  params: Record<string, unknown>
): Promise<RuntimeCallResult> {
  return page.evaluate(
    async ({ targetMethod, targetParams }) => {
      try {
        return (await window.api.runtime.call({
          method: targetMethod,
          params: targetParams
        })) as { ok: boolean; error?: { code?: string; message?: string }; result?: unknown }
      } catch (error) {
        return { ok: false, error: { message: String(error) } }
      }
    },
    { targetMethod: method, targetParams: params }
  )
}

type Shot = { path: string; magentaFraction: number; cyanFraction: number }

/** Composite the real window — the only capture that includes <webview> guests. */
async function captureWindow(
  electronApp: ElectronApplication,
  testInfo: TestInfo,
  name: string
): Promise<Shot> {
  const target = testInfo.outputPath(name)
  const shot = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) {
      return { png: '', magenta: 0, cyan: 0, total: 1 }
    }
    const image = await win.capturePage()
    const bitmap = image.toBitmap()
    let magenta = 0
    let cyan = 0
    for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
      // Electron's toBitmap() is BGRA.
      const blue = bitmap[offset]
      const green = bitmap[offset + 1]
      const red = bitmap[offset + 2]
      if (red > 200 && blue > 200 && green < 80) {
        magenta += 1
      } else if (green > 200 && blue > 200 && red < 80) {
        cyan += 1
      }
    }
    return {
      png: image.toPNG().toString('base64'),
      magenta,
      cyan,
      total: Math.max(1, bitmap.length / 4)
    }
  })
  writeFileSync(target, Buffer.from(shot.png, 'base64'))
  return {
    path: target,
    magentaFraction: Number((shot.magenta / shot.total).toFixed(5)),
    cyanFraction: Number((shot.cyan / shot.total).toFixed(5))
  }
}

async function setActiveBrowserTab(page: Page, worktreeId: string, tabId: string): Promise<void> {
  await page.evaluate((targetTabId) => {
    window.__store?.getState().setActiveBrowserTab(targetTabId)
  }, tabId)
  await expect
    .poll(
      async () =>
        page.evaluate(
          (targetWorktreeId) =>
            window.__store?.getState().activeBrowserTabIdByWorktree?.[targetWorktreeId] ?? null,
          worktreeId
        ),
      { timeout: 10_000 }
    )
    .toBe(tabId)
}

/** Put a terminal tab in front — what the user is actually looking at. */
async function showTerminal(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate((targetWorktreeId) => {
    const store = window.__store
    if (!store) {
      return
    }
    const state = store.getState()
    const terminalTab = (state.tabsByWorktree[targetWorktreeId] ?? [])[0]
    if (terminalTab) {
      state.setActiveTab(terminalTab.id)
    }
    state.setActiveTabType('terminal')
  }, worktreeId)
  await expect.poll(async () => getActiveTabType(page), { timeout: 10_000 }).toBe('terminal')
  await expect(page.locator('.xterm-screen').first()).toBeVisible({ timeout: 20_000 })
  // capturePage trails the compositor; settle before trusting a frame.
  await page.waitForTimeout(1_500)
}

// Why: agent-browser's unix socket path is capped at 103 bytes, and the isolated
// E2E home plus a uuid session name blows past it — snapshot then fails for a
// reason that has nothing to do with what this spec measures.
const AGENT_BROWSER_SOCKET_DIR = '/tmp/oab-e2e'
mkdirSync(AGENT_BROWSER_SOCKET_DIR, { recursive: true })

test.describe('Background browser commands keep the user view @headful', () => {
  test.use({ orcaAppExtraEnv: { AGENT_BROWSER_SOCKET_DIR } })

  test('a targeted read against a background page never paints it', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    const pages = await startTwoColourServer()
    try {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
      })

      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      const worktreeId = (await getActiveWorktreeId(orcaPage))!

      const tabA = await createBrowserTab(orcaPage, worktreeId, pages.urlA, 'PAGE A')
      await waitForGuestMarker(orcaPage, tabA.tabId, PAGE_A_MARKER)
      const tabB = await createBrowserTab(orcaPage, worktreeId, pages.urlB, 'PAGE B')
      await waitForGuestMarker(orcaPage, tabB.tabId, PAGE_B_MARKER)

      // A is the active browser tab; B is a background page.
      await setActiveBrowserTab(orcaPage, worktreeId, tabA.tabId)
      await showTerminal(orcaPage, worktreeId)

      const capture = (name: string): Promise<Shot> => captureWindow(electronApp, testInfo, name)

      const baselineState = await readViewState(orcaPage, worktreeId, tabB.pageId)
      const baselineShot = await capture('baseline-terminal.png')
      expect(baselineState.activeTabType).toBe('terminal')
      expect(baselineState.shellDisplay, 'B was already painted before any command').toBe('none')

      // ── Targeted READ against the background page B ──
      expect(await watchShellStyle(orcaPage, tabB.pageId)).toBe(true)
      const evalB = await callRuntime(orcaPage, 'browser.eval', {
        worktree: `id:${worktreeId}`,
        page: tabB.pageId,
        expression: IDENTITY_EXPRESSION
      })
      const snapshotB = await callRuntime(orcaPage, 'browser.snapshot', {
        worktree: `id:${worktreeId}`,
        page: tabB.pageId
      })
      const backgroundHistory = await readShellStyleHistory(orcaPage, tabB.pageId)
      const duringState = await readViewState(orcaPage, worktreeId, tabB.pageId)
      const duringShot = await capture('during-background-read.png')

      // ── Counterpart: no explicit page still targets (and may paint) the active tab ──
      expect(await watchShellStyle(orcaPage, tabA.pageId)).toBe(true)
      const evalImplicit = await callRuntime(orcaPage, 'browser.eval', {
        worktree: `id:${worktreeId}`,
        expression: IDENTITY_EXPRESSION
      })
      const implicitHistory = await readShellStyleHistory(orcaPage, tabA.pageId)
      const afterState = await readViewState(orcaPage, worktreeId, tabB.pageId)
      const afterShot = await capture('after-implicit-read.png')

      await testInfo.attach('orca512-regression.json', {
        body: JSON.stringify(
          {
            worktreeId,
            tabA,
            tabB,
            evalB,
            snapshotB,
            evalImplicit,
            backgroundHistory,
            implicitHistory,
            states: { baselineState, duringState, afterState },
            captures: { baselineShot, duringShot, afterShot }
          },
          null,
          2
        ),
        contentType: 'application/json'
      })

      // The command must have actually reached page B, or nothing below is a test.
      expect(evalB.ok, `browser.eval against B failed: ${JSON.stringify(evalB.error)}`).toBe(true)
      expect(
        (evalB.result as { result?: string } | undefined)?.result,
        "the background read did not return page B's own DOM"
      ).toBe(identityOf(PAGE_B_MARKER, PAGE_B_LABEL, '/b'))

      // An unpainted guest must still yield a usable accessibility snapshot.
      expect(
        snapshotB.ok,
        `browser.snapshot against B failed: ${JSON.stringify(snapshotB.error)}`
      ).toBe(true)
      const snapshotText = JSON.stringify(snapshotB.result)
      expect(snapshotText, "snapshot of B does not name B's own heading").toContain(PAGE_B_LABEL)
      expect(snapshotText, 'snapshot of B leaked page A').not.toContain(PAGE_A_LABEL)

      // The view the user is looking at is untouched.
      expect(duringState.activeTabType).toBe('terminal')
      expect(duringState.groupActiveTabId).toBe(baselineState.groupActiveTabId)
      expect(duringState.activeBrowserTabId).toBe(tabA.tabId)
      expect(duringState.shellDisplay, "B's viewport shell was made paintable").toBe('none')
      expect(
        backgroundHistory.sawFlex,
        "B's viewport shell flipped to display:flex during the command"
      ).toBe(false)
      expect(duringShot.magentaFraction, 'page B was painted into the window').toBe(0)

      // The fix must not have removed the lease for implicit-target commands.
      expect(evalImplicit.ok).toBe(true)
      expect(
        (evalImplicit.result as { result?: string } | undefined)?.result,
        'implicit browser.eval did not run against the active tab A'
      ).toBe(identityOf(PAGE_A_MARKER, PAGE_A_LABEL, '/a'))
      expect(
        implicitHistory.sawFlex,
        'an implicit-target command no longer paints the active page — the lease regressed'
      ).toBe(true)

      // Secondary guard only: the lease also sets opacity 0, so these stay 0 with
      // the bug too. `backgroundHistory.sawFlex` above is the discriminating check.
      expect(afterState.activeTabType).toBe('terminal')
      expect(afterState.groupActiveTabId).toBe(baselineState.groupActiveTabId)
      expect(afterShot.magentaFraction).toBe(0)
      expect(afterShot.cyanFraction).toBe(0)
      expect(baselineShot.magentaFraction).toBe(0)
    } finally {
      await pages.close()
    }
  })

  /**
   * The shape actually reported: one browser tab, so the page the agent names IS
   * the active browser tab — while the user sits on a terminal. "Active browser
   * tab" is not "the surface in front", so naming it must still not paint it.
   */
  test('a targeted read against the active browser tab never paints it either', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    const pages = await startTwoColourServer()
    try {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
      })

      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      const worktreeId = (await getActiveWorktreeId(orcaPage))!

      // Exactly one browser tab, and it is the active one.
      const tabB = await createBrowserTab(orcaPage, worktreeId, pages.urlB, 'PAGE B')
      await waitForGuestMarker(orcaPage, tabB.tabId, PAGE_B_MARKER)
      await setActiveBrowserTab(orcaPage, worktreeId, tabB.tabId)
      await showTerminal(orcaPage, worktreeId)

      const baselineState = await readViewState(orcaPage, worktreeId, tabB.pageId)
      const baselineShot = await captureWindow(
        electronApp,
        testInfo,
        'active-baseline-terminal.png'
      )
      expect(baselineState.activeTabType).toBe('terminal')
      expect(baselineState.activeBrowserTabId, 'B is not the active browser tab').toBe(tabB.tabId)
      expect(baselineState.shellDisplay).toBe('none')

      expect(await watchShellStyle(orcaPage, tabB.pageId)).toBe(true)
      const evalB = await callRuntime(orcaPage, 'browser.eval', {
        worktree: `id:${worktreeId}`,
        page: tabB.pageId,
        expression: IDENTITY_EXPRESSION
      })
      const history = await readShellStyleHistory(orcaPage, tabB.pageId)
      const duringState = await readViewState(orcaPage, worktreeId, tabB.pageId)
      const duringShot = await captureWindow(electronApp, testInfo, 'active-during-read.png')

      await testInfo.attach('orca512-active-tab.json', {
        body: JSON.stringify(
          {
            worktreeId,
            tabB,
            evalB,
            history,
            states: { baselineState, duringState },
            captures: { baselineShot, duringShot }
          },
          null,
          2
        ),
        contentType: 'application/json'
      })

      expect(evalB.ok, `browser.eval against B failed: ${JSON.stringify(evalB.error)}`).toBe(true)
      expect(
        (evalB.result as { result?: string } | undefined)?.result,
        "the read did not return page B's own DOM"
      ).toBe(identityOf(PAGE_B_MARKER, PAGE_B_LABEL, '/b'))

      expect(duringState.activeTabType).toBe('terminal')
      expect(duringState.groupActiveTabId).toBe(baselineState.groupActiveTabId)
      expect(duringState.shellDisplay, "B's viewport shell was made paintable").toBe('none')
      expect(
        history.sawFlex,
        "naming the active browser tab still painted it over the user's terminal"
      ).toBe(false)
      expect(duringShot.magentaFraction).toBe(0)

      // Why: without this the magenta assertions above are unfalsifiable — a capture
      // that never composites <webview> guests would read 0 whatever the pane did.
      await orcaPage.evaluate((targetTabId) => {
        const state = window.__store!.getState()
        state.setActiveBrowserTab(targetTabId)
        state.setActiveTabType('browser')
      }, tabB.tabId)
      await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 10_000 }).toBe('browser')
      await orcaPage.waitForTimeout(1_500)
      const frontShot = await captureWindow(electronApp, testInfo, 'active-page-in-front.png')
      expect(
        frontShot.magentaFraction,
        `capturePage does not composite webview guests: page B is in front and magenta is ${frontShot.magentaFraction}`
      ).toBeGreaterThan(0.05)
    } finally {
      await pages.close()
    }
  })

  /**
   * A fast read releases its lease before any screenshot lands, so the pixel
   * channel can never see it. This case holds the command open for 3s and
   * photographs the window mid-flight — the only frame that can show the user
   * what a held lease actually does to his screen.
   */
  test('a slow targeted read never shows the background page while it runs', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    const pages = await startTwoColourServer()
    try {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
      })

      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      const worktreeId = (await getActiveWorktreeId(orcaPage))!

      const tabA = await createBrowserTab(orcaPage, worktreeId, pages.urlA, 'PAGE A')
      await waitForGuestMarker(orcaPage, tabA.tabId, PAGE_A_MARKER)
      const tabB = await createBrowserTab(orcaPage, worktreeId, pages.urlB, 'PAGE B')
      await waitForGuestMarker(orcaPage, tabB.tabId, PAGE_B_MARKER)
      await setActiveBrowserTab(orcaPage, worktreeId, tabA.tabId)
      await showTerminal(orcaPage, worktreeId)

      const baselineShot = await captureWindow(electronApp, testInfo, 'slow-baseline-terminal.png')
      expect(await watchShellStyle(orcaPage, tabB.pageId)).toBe(true)

      // Deliberately not awaited: the window is photographed while the command
      // still holds whatever visibility it took.
      const inFlight = callRuntime(orcaPage, 'browser.eval', {
        worktree: `id:${worktreeId}`,
        page: tabB.pageId,
        expression: `new Promise((resolve) => setTimeout(() => resolve('${SLOW_SENTINEL}'), 3000))`
      })
      await orcaPage.waitForTimeout(1_200)
      const midState = await readViewState(orcaPage, worktreeId, tabB.pageId)
      const midShot = await captureWindow(electronApp, testInfo, 'slow-mid-command.png')
      const slowEval = await inFlight
      const history = await readShellStyleHistory(orcaPage, tabB.pageId)

      await testInfo.attach('orca512-slow-lease.json', {
        body: JSON.stringify(
          { worktreeId, tabA, tabB, slowEval, midState, history, baselineShot, midShot },
          null,
          2
        ),
        contentType: 'application/json'
      })

      expect(slowEval.ok, `slow browser.eval failed: ${JSON.stringify(slowEval.error)}`).toBe(true)
      expect(
        (slowEval.result as { result?: string } | undefined)?.result,
        'the slow read did not complete against page B'
      ).toBe(SLOW_SENTINEL)
      // The mid-command frame is the photograph: it was taken with the command open.
      expect(
        midShot.magentaFraction,
        'page B was on screen while a targeted read against it was running'
      ).toBe(0)
      expect(midState.activeTabType).toBe('terminal')
      expect(midState.shellDisplay, "B's viewport shell was paintable mid-command").toBe('none')
      expect(history.sawFlex, "B's viewport shell flipped to display:flex").toBe(false)
    } finally {
      await pages.close()
    }
  })
})
