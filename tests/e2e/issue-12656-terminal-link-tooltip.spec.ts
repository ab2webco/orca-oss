import { randomUUID } from 'node:crypto'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  getTerminalContent,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

type TooltipState = {
  display: string
  text: string
  currentLinkText: string | null
  cursor: string
  paneBottom: number
  terminalBottom: number
  tooltipTop: number
  tooltipBottom: number
  tooltipHeight: number
}

type HoverPollResult = TooltipState | { display: 'unlocated'; currentLinkText: null }

async function resolveTerminalTabId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    return state?.activeTabType === 'terminal'
      ? (state.activeTabId ?? null)
      : worktreeId
        ? (state.activeTabIdByWorktree?.[worktreeId] ?? null)
        : null
  })
}

/**
 * Locates the URL and hovers it in a single evaluate: viewport rows shift as the
 * shell keeps printing, so coordinates resolved in an earlier round trip point at
 * whatever scrolled into that row instead.
 */
async function hoverUrl(
  page: Page,
  tabId: string,
  url: string
): Promise<{ row: number; col: number } | null> {
  return page.evaluate(
    ({ tabId, url }) => {
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
      const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen')
      if (!pane || !screen) {
        return null
      }

      const buffer = pane.terminal.buffer.active
      let target: { row: number; col: number } | null = null
      for (let row = 0; row < pane.terminal.rows; row += 1) {
        const line = buffer.getLine(buffer.viewportY + row)
        const col = line?.translateToString(true).indexOf(url) ?? -1
        if (col >= 0) {
          target = { row, col: col + Math.floor(url.length / 2) }
          break
        }
      }
      if (!target) {
        return null
      }

      const rect = screen.getBoundingClientRect()
      const move = (col: number, row: number): void => {
        screen.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + (col + 0.5) * (rect.width / pane.terminal.cols),
            clientY: rect.top + (row + 0.5) * (rect.height / pane.terminal.rows)
          })
        )
      }
      // Why: xterm skips hover work when a mousemove lands on the cell it last
      // handled, so a retry only re-evaluates after passing through another cell.
      move(0, target.row === 0 ? 1 : 0)
      move(target.col, target.row)
      return target
    },
    { tabId, url }
  )
}

async function readTooltipState(page: Page, tabId: string): Promise<TooltipState> {
  return page.evaluate((tabId) => {
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen')
    if (!pane || !screen) {
      throw new Error('terminal pane unavailable')
    }

    const linkifier = (
      pane.terminal as unknown as {
        _core?: { linkifier?: { currentLink?: { link?: { text?: string } } } }
      }
    )._core?.linkifier
    const paneRect = pane.container.getBoundingClientRect()
    const terminalRect = pane.terminal.element?.parentElement?.getBoundingClientRect()
    const tooltipRect = pane.linkTooltip.getBoundingClientRect()

    return {
      display: pane.linkTooltip.style.display,
      text: pane.linkTooltip.textContent ?? '',
      currentLinkText: linkifier?.currentLink?.link?.text ?? null,
      cursor: getComputedStyle(screen).cursor,
      paneBottom: paneRect.bottom,
      terminalBottom: terminalRect?.bottom ?? 0,
      tooltipTop: tooltipRect.top,
      tooltipBottom: tooltipRect.bottom,
      tooltipHeight: tooltipRect.height
    }
  }, tabId)
}

function printUrlAfterFillerCommand(url: string, fillerLines: number): string {
  const encodedUrl = Buffer.from(url, 'utf8').toString('base64')
  // Why: the shell echoes the command line, so a literal URL there is hoverable
  // before the process runs — the spec would then assert against the echo and
  // lose the link as soon as the real output scrolls that row away.
  return `${nodeTerminalCommand([
    '-e',
    `for (let i = 1; i <= ${fillerLines}; i += 1) console.log('issue-12656-output-' + String(i).padStart(2, '0')); console.log(Buffer.from('${encodedUrl}', 'base64').toString('utf8'))`
  ])}\r`
}

async function readTerminalRows(page: Page, tabId: string): Promise<number> {
  return page.evaluate((tabId) => {
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    return pane?.terminal.rows ?? 0
  }, tabId)
}

async function printUrlBelowAFullViewport(
  page: Page,
  ptyId: string,
  tabId: string,
  url: string
): Promise<void> {
  // Overfill the viewport so the buffer is already scrolling, as it is on CI.
  const fillerLines = (await readTerminalRows(page, tabId)) + 5
  await sendToTerminal(page, ptyId, printUrlAfterFillerCommand(url, fillerLines))
  await waitForTerminalOutput(page, url)
}

async function captureProof(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
}

async function printHoverableUrl(
  page: Page
): Promise<{ ptyId: string; tabId: string; url: string }> {
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page)

  const ptyId = await waitForActivePanePtyId(page)
  await waitForPtyShellEcho(page, ptyId, 15_000)
  const tabId = await resolveTerminalTabId(page)
  if (!tabId) {
    throw new Error('no active terminal tab to hover')
  }

  const url = `https://example.com/orca-issue-12656-${randomUUID().slice(0, 8)}`
  await printUrlBelowAFullViewport(page, ptyId, tabId, url)
  return { ptyId, tabId, url }
}

test.describe('Issue #12656 terminal link tooltip', () => {
  test('clears hover state without permanently shrinking the terminal', async ({
    orcaPage
  }, testInfo) => {
    const { tabId, url } = await printHoverableUrl(orcaPage)

    const idle = await readTooltipState(orcaPage, tabId)
    expect(Math.abs(idle.paneBottom - idle.terminalBottom)).toBeLessThanOrEqual(1)
    await expect
      .poll(
        async (): Promise<HoverPollResult> => {
          const target = await hoverUrl(orcaPage, tabId, url)
          if (!target) {
            return { display: 'unlocated', currentLinkText: null }
          }
          return readTooltipState(orcaPage, tabId)
        },
        { message: 'hovering the printed URL never opened the link tooltip' }
      )
      .toMatchObject({ display: '', currentLinkText: url })

    const hovered = await readTooltipState(orcaPage, tabId)
    expect(hovered.text).toContain(url)
    expect(hovered.tooltipHeight).toBeGreaterThan(0)
    expect(Math.abs(hovered.paneBottom - hovered.terminalBottom)).toBeLessThanOrEqual(1)
    expect(Math.abs(hovered.paneBottom - hovered.tooltipBottom)).toBeLessThanOrEqual(1)
    expect(hovered.tooltipTop).toBeLessThan(hovered.terminalBottom)
    await captureProof(orcaPage, testInfo, 'issue-12656-fixed-hover.png')

    await orcaPage.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect
      .poll(() => readTooltipState(orcaPage, tabId))
      .toMatchObject({ display: 'none', currentLinkText: null, cursor: 'text' })
    const cleared = await readTooltipState(orcaPage, tabId)
    expect(Math.abs(cleared.paneBottom - cleared.terminalBottom)).toBeLessThanOrEqual(1)
    await captureProof(orcaPage, testInfo, 'issue-12656-fixed-after-blur.png')

    await expect.poll(() => getTerminalContent(orcaPage)).toContain(url)
  })

  test('hovers the link again after the viewport scrolls under it', async ({ orcaPage }) => {
    const { ptyId, tabId, url } = await printHoverableUrl(orcaPage)

    const beforeScroll = await hoverUrl(orcaPage, tabId, url)
    if (!beforeScroll) {
      throw new Error('URL never became hoverable before the scroll')
    }

    // A bare Enter reprints the prompt, shifting every viewport row up by one.
    await sendToTerminal(orcaPage, ptyId, '\r')
    await expect
      .poll(
        async () => {
          const target = await hoverUrl(orcaPage, tabId, url)
          if (!target || target.row !== beforeScroll.row - 1) {
            return { row: target?.row ?? null, currentLinkText: null }
          }
          const state = await readTooltipState(orcaPage, tabId)
          return { row: target.row, currentLinkText: state.currentLinkText }
        },
        { message: 'the link tooltip did not reopen at the scrolled row' }
      )
      .toMatchObject({ row: beforeScroll.row - 1, currentLinkText: url })
  })
})
