import { execFileSync } from 'node:child_process'
import type { Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'

const MIN_CLAUDE = [2, 1, 287]

/** The game mod needs Claude Code 2.1.287 or newer on PATH; the showcases skip without it. */
export function claudeVersionOk(): boolean {
  try {
    const out = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 15_000 })
    const parts = (/(\d+)\.(\d+)\.(\d+)/.exec(out) ?? []).slice(1).map(Number)
    for (let i = 0; i < 3; i++) {
      if ((parts[i] ?? 0) !== MIN_CLAUDE[i]) {
        return (parts[i] ?? 0) > MIN_CLAUDE[i]!
      }
    }
    return true
  } catch {
    return false
  }
}

/** The visible text of every terminal pane: the Panel is its own pane beside the band's. */
export async function visibleTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines: string[] = []
    for (const manager of window.__paneManagers?.values() ?? []) {
      for (const pane of manager.getPanes?.() ?? []) {
        const buffer = pane.terminal.buffer.active
        for (let row = 0; row < pane.terminal.rows; row++) {
          lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString() ?? '')
        }
      }
    }
    return lines.join('\n')
  })
}

/** Clicks the last drawn occurrence of `text` on a terminal screen, the active pane first. */
export async function clickTerminalText(page: Page, text: string): Promise<void> {
  const point = await page.evaluate((needle) => {
    for (const manager of window.__paneManagers?.values() ?? []) {
      const panes = [manager.getActivePane?.(), ...(manager.getPanes?.() ?? [])]
      for (const pane of panes) {
        const screen = pane?.container.querySelector<HTMLElement>('.xterm-screen')
        if (!pane || !screen) {
          continue
        }
        const terminal = pane.terminal
        const buffer = terminal.buffer.active
        const rect = screen.getBoundingClientRect()
        const cellWidth = rect.width / terminal.cols
        const cellHeight = rect.height / terminal.rows
        for (let row = terminal.rows - 1; row >= 0; row--) {
          const line = buffer.getLine(buffer.viewportY + row)?.translateToString() ?? ''
          const col = line.indexOf(needle)
          if (col !== -1) {
            return {
              x: rect.left + (col + needle.length / 2) * cellWidth,
              y: rect.top + (row + 0.5) * cellHeight
            }
          }
        }
      }
    }
    return null
  }, text)
  expect(point, `"${text}" is not on the terminal screen`).not.toBeNull()
  await page.mouse.click(point!.x, point!.y)
}
