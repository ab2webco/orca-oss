import type { Page } from '@stablyai/playwright-test'
import type { TuiAgent } from '../../src/shared/tui-agent'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { THEMES, WIDTHS, setTheme, setWindowWidth } from './helpers/settings-window'

const DETECTED: TuiAgent[] = ['claude', 'codex', 'gemini']

type RowReport = { agent: string; problems: string[] }

async function openAgentsPane(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.locator('[data-settings-section="agents"]')).toBeVisible({ timeout: 15_000 })
}

/** Each Installed row's name, badge and controls: any two that overlap, or a label cut by its box. */
async function measureInstalledRows(page: Page): Promise<RowReport[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-row]'))
    return rows.map((row) => {
      const parts: [string, Element | null][] = [
        ['name', row.querySelector('[data-agent-row-name]')],
        ['availability', row.querySelector('[role="radiogroup"]')],
        ['default', row.querySelector('[data-agent-row-default]')],
        ['docs', row.querySelector('a[target="_blank"]')],
        ['command', row.querySelector('button[aria-label*="command override"]')]
      ]
      const boxes = parts
        .filter((part): part is [string, Element] => part[1] !== null)
        .map(([name, element]) => ({ name, element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0)
      const problems: string[] = []
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].rect
          const b = boxes[j].rect
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (x > 1 && y > 1) {
            problems.push(`${boxes[i].name} overlaps ${boxes[j].name}`)
          }
        }
      }
      for (const { name, element } of boxes) {
        for (const node of [element, ...Array.from(element.querySelectorAll('*'))]) {
          if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) {
            if (getComputedStyle(node).textOverflow !== 'ellipsis') {
              problems.push(`${name} spills its box`)
              break
            }
          }
        }
      }
      return { agent: row.dataset.agentRow ?? '', problems }
    })
  })
}

// ORCA-1328 (L4): a disabled agent's badge and the enabled one's Set default must not collide.
test('Settings → Agents: Installed rows keep name, availability and Set default apart', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await writeSettings(orcaPage, { disabledTuiAgents: ['codex'], defaultTuiAgent: 'claude' })
  await openAgentsPane(orcaPage)
  await orcaPage.evaluate((ids) => window.__store!.setState({ detectedAgentIds: ids }), DETECTED)
  const firstRow = orcaPage.locator('[data-agent-row="claude"]')
  await expect(firstRow).toBeVisible({ timeout: 15_000 })

  const failures: string[] = []
  for (const language of ['en', 'es'] as const) {
    await writeSettings(orcaPage, { uiLanguage: language })
    await expect(orcaPage.locator('[data-agent-row="codex"] [data-agent-row-name]')).toContainText(
      language === 'es' ? 'Desactivado' : 'Disabled'
    )
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await firstRow.evaluate((element) => element.scrollIntoView({ block: 'start' }))
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`installed-${language}-${width}-${theme}.png`)
        })
        for (const row of await measureInstalledRows(orcaPage)) {
          for (const problem of row.problems) {
            failures.push(`${language} ${width} ${row.agent}: ${problem}`)
          }
        }
      }
    }
  }
  expect([...new Set(failures)]).toEqual([])
})
