/**
 * ORCA-802: a row selection over a Claude Code pane with the Orca Game Panel docked beside the chat
 * used to copy each row's padding and the Panel's `│` border. Paints a real captured Claude screen,
 * drags a native selection over the commands and asserts the exact clipboard text.
 */
import path from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount
} from './helpers/terminal'

const FRAME_FIXTURE = path.join(process.cwd(), 'tests/e2e/fixtures/claude-dock-frame.cjs')
const CAPTURES = path.join(
  process.cwd(),
  'src/renderer/src/components/terminal-pane/__fixtures__/claude-dock-captures.json'
)
const RUN_FRAME = `clear; node "${FRAME_FIXTURE}" "${CAPTURES}"`
const COMMANDS = 'git fetch origin\n     git rebase origin/main\n     git push --force-with-lease'
const LAST_COMMAND = 'git push --force-with-lease'
const WIDTHS = [1440, 768, 390, 320]
const IS_MAC = process.platform === 'darwin'
const COPY_KEY = IS_MAC ? 'Meta+C' : 'Control+Shift+C'
const PASTE_KEY = IS_MAC ? 'Meta+V' : 'Control+Shift+V'
// Shift-drag (Option on macOS) takes xterm's own selection over Claude's mouse mode.
const SELECT_MODIFIER = IS_MAC ? 'Alt' : 'Shift'

type Cell = { x: number; y: number }
type FrameLayout = {
  cellWidth: number
  cellHeight: number
  left: number
  top: number
  cols: number
  isAltScreen: boolean
  cursorRow: string
  first: Cell
  last: Cell
  border: number
  hasWrappedRow: boolean
}

async function readLayout(page: Page): Promise<FrameLayout> {
  return page.evaluate((lastCommand) => {
    const tabId = window.__store!.getState().activeTabId as string
    const terminal = window.__paneManagers!.get(tabId)!.getActivePane()!.terminal
    const rect = terminal.element!.querySelector('.xterm-screen')!.getBoundingClientRect()
    const buffer = terminal.buffer.active
    const rows = Array.from(
      { length: terminal.rows },
      (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? ''
    )
    const lastY = rows.findLastIndex((row) => row.includes(lastCommand))
    return {
      // Why: the frame positions every row itself, so a wrapped row means it was painted for a wider pty.
      hasWrappedRow: rows.some((_, y) => buffer.getLine(buffer.viewportY + y)?.isWrapped === true),
      cellWidth: rect.width / terminal.cols,
      cellHeight: rect.height / terminal.rows,
      left: rect.left,
      top: rect.top,
      cols: terminal.cols,
      isAltScreen: buffer.type === 'alternate',
      cursorRow: rows[buffer.cursorY] ?? '',
      first: { x: rows[lastY - 2]?.indexOf('git fetch') ?? -1, y: lastY - 2 },
      last: { x: (rows[lastY]?.indexOf(lastCommand) ?? 0) + lastCommand.length, y: lastY },
      border: rows[0]?.indexOf('│') ?? -1
    }
  }, LAST_COMMAND)
}

async function paintFrame(page: Page, isDocked: boolean): Promise<FrameLayout> {
  let layout = await readLayout(page)
  await expect
    .poll(
      async () => {
        layout = await readLayout(page)
        return (
          layout.isAltScreen &&
          !layout.hasWrappedRow &&
          layout.first.x >= 0 &&
          layout.border >= 0 === isDocked
        )
      },
      { message: 'the Claude frame never painted at this width' }
    )
    .toBe(true)
  return layout
}

// Why: input typed before the shell is back is lost to the interrupted program's flush.
async function waitForShellPrompt(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const layout = await readLayout(page)
      return !layout.isAltScreen && /[$#%>] *$/.test(layout.cursorRow)
    })
    .toBe(true)
}

async function dragOverCommands(page: Page, layout: FrameLayout): Promise<void> {
  const at = (cell: Cell) => ({
    x: layout.left + cell.x * layout.cellWidth + 1,
    y: layout.top + (cell.y + 0.5) * layout.cellHeight
  })
  // A docked drag ends inside the Panel, past the border, as a loose drag does.
  const endX = layout.border > 0 ? Math.min(layout.cols - 2, layout.border + 6) : layout.last.x
  const start = at(layout.first)
  const end = at({ x: endX, y: layout.last.y })
  await page.keyboard.down(SELECT_MODIFIER)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up(SELECT_MODIFIER)
}

async function rawSelection(page: Page): Promise<string> {
  return page.evaluate(() => {
    const tabId = window.__store!.getState().activeTabId as string
    return window.__paneManagers!.get(tabId)!.getActivePane()!.terminal.getSelection()
  })
}

async function clipboardAfter(
  app: ElectronApplication,
  copy: () => Promise<void>
): Promise<string> {
  await app.evaluate(({ clipboard }) => clipboard.writeText('clipboard-before-copy'))
  await copy()
  let text = ''
  await expect
    .poll(async () => (text = await app.evaluate(({ clipboard }) => clipboard.readText())))
    .not.toBe('clipboard-before-copy')
  return text
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
}

async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

// Why: a frame started while the pty is still being resized can read the old width and keep it.
async function runFrameAtPaneSize(page: Page, ptyId: string): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(async (id) => {
        const tabId = window.__store!.getState().activeTabId as string
        const terminal = window.__paneManagers!.get(tabId)!.getActivePane()!.terminal
        const size = await window.api.pty.getSize(id)
        return size?.cols === terminal.cols && size?.rows === terminal.rows
      }, ptyId)
    )
    .toBe(true)
  await execInTerminal(page, ptyId, RUN_FRAME)
}

test.describe('copying beside a docked Claude Code pane', () => {
  let ptyId = ''

  test.beforeEach(async ({ electronApp, orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await waitForPaneCount(orcaPage, 1, 30_000)
    // Why: only a pane at least 110 columns wide docks the Panel, which at 1440 needs both sidebars shut.
    await orcaPage.evaluate(() => {
      window.__store!.getState().setSidebarOpen(false)
      window.__store!.getState().setRightSidebarOpen(false)
    })
    await setWindowWidth(electronApp, orcaPage, 1440)
    ptyId = await waitForActivePanePtyId(orcaPage)
    await waitForShellPrompt(orcaPage)
    await runFrameAtPaneSize(orcaPage, ptyId)
  })

  test('copy-on-select, the copy key and the primary selection take only the chat text', async ({
    electronApp,
    orcaPage
  }) => {
    const layout = await paintFrame(orcaPage, true)
    await orcaPage.evaluate(async () => {
      const settings = await window.api.settings.set({ terminalClipboardOnSelect: true })
      window.__store?.setState({ settings })
    })

    const onSelect = await clipboardAfter(electronApp, () => dragOverCommands(orcaPage, layout))
    expect(await rawSelection(orcaPage), 'the drag did not cross the Panel border').toContain('│')
    expect(onSelect).toBe(COMMANDS)

    expect(await clipboardAfter(electronApp, () => orcaPage.keyboard.press(COPY_KEY))).toBe(
      COMMANDS
    )

    if (process.platform === 'linux') {
      // The middle-click PRIMARY selection is written from the same drag.
      await expect
        .poll(async () => electronApp.evaluate(({ clipboard }) => clipboard.readText('selection')))
        .toBe(COMMANDS)
    }
  })

  test('the selection and its paste at each width in both themes', async ({
    electronApp,
    orcaPage
  }, testInfo: TestInfo) => {
    test.setTimeout(300_000)
    await sendToTerminal(orcaPage, ptyId, 'q')
    await waitForShellPrompt(orcaPage)
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await runFrameAtPaneSize(orcaPage, ptyId)
        const layout = await paintFrame(orcaPage, width === 1440)
        await dragOverCommands(orcaPage, layout)
        await orcaPage.screenshot({ path: testInfo.outputPath(`selection-${width}-${theme}.png`) })
        const copied = await clipboardAfter(electronApp, () => orcaPage.keyboard.press(COPY_KEY))
        expect(copied, `${width} ${theme}`).toBe(COMMANDS)

        // Why `cat > /dev/null`: the pasted commands echo on screen and none of them runs.
        await sendToTerminal(orcaPage, ptyId, 'q')
        await waitForShellPrompt(orcaPage)
        await execInTerminal(orcaPage, ptyId, 'clear; cat > /dev/null')
        await expect.poll(async () => (await readLayout(orcaPage)).cursorRow.trim()).toBe('')
        await focusActiveTerminalInput(orcaPage)
        await orcaPage.keyboard.press(PASTE_KEY)
        await expect.poll(async () => (await readLayout(orcaPage)).last.y).toBeGreaterThan(-1)
        expect(await rawScreen(orcaPage)).toContain(COMMANDS)
        await orcaPage.screenshot({ path: testInfo.outputPath(`pasted-${width}-${theme}.png`) })

        await sendToTerminal(orcaPage, ptyId, '\x03')
        await waitForShellPrompt(orcaPage)
      }
    }
  })
})

async function rawScreen(page: Page): Promise<string> {
  return page.evaluate(() => {
    const tabId = window.__store!.getState().activeTabId as string
    const terminal = window.__paneManagers!.get(tabId)!.getActivePane()!.terminal
    const buffer = terminal.buffer.active
    return Array.from(
      { length: terminal.rows },
      (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? ''
    ).join('\n')
  })
}
