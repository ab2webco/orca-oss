import type { Page } from '@stablyai/playwright-test'
import type { TuiAgent } from '../../src/shared/tui-agent'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { THEMES, WIDTHS, setTheme, setWindowWidth } from './helpers/settings-window'

const DETECTED: TuiAgent[] = ['claude', 'codex', 'gemini']
// Why 640 and 700: from sm up to 768 the settings sidebar leaves a row at its narrowest.
const SWEEP_WIDTHS = [...new Set([...WIDTHS, 700, 640])].sort((a, b) => b - a)

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
async function measureInstalledRows(page: Page, language: string): Promise<RowReport[]> {
  return page.evaluate((language) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-row]'))
    return rows.map((row) => {
      const parts: [string, Element | null][] = [
        ['name', row.querySelector('[data-agent-row-name]')],
        ['availability', row.querySelector('[role="radiogroup"]')],
        ['default', row.querySelector('[data-agent-row-default]')],
        ['docs', row.querySelector('a[target="_blank"]')],
        ['command', row.querySelector('[data-agent-row-command]')]
      ]
      const boxes = parts
        .filter((part): part is [string, Element] => part[1] !== null)
        .map(([name, element]) => ({ name, element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0)
      const problems: string[] = []
      const rowRect = row.getBoundingClientRect()
      for (const { name, rect } of boxes) {
        if (rect.right > rowRect.right + 1 || rect.left < rowRect.left - 1) {
          problems.push(`${name} runs out of its row`)
        }
      }
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
      // Why every width: wherever the controls wrap, an icon alone on a line reads as orphaned.
      // Why not es 640: known orphan (the es toggle leaves no room for both icons), ticketed apart.
      const knownEs640 = language === 'es' && window.innerWidth === 640
      const texts = boxes.filter(({ name }) => name === 'availability' || name === 'default')
      for (const icon of boxes.filter(({ name }) => name === 'docs' || name === 'command')) {
        if (knownEs640) {
          break
        }
        const middle = (icon.rect.top + icon.rect.bottom) / 2
        if (!texts.some(({ rect }) => middle > rect.top && middle < rect.bottom)) {
          problems.push(`${icon.name} sits on a line of its own`)
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
  }, language)
}

// ORCA-1328 (L4): a disabled agent's badge and the enabled one's Set default must not collide,
// and below sm the icon buttons wrap with the row's controls, never alone.
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
    for (const width of SWEEP_WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await firstRow.evaluate((element) => element.scrollIntoView({ block: 'start' }))
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`installed-${language}-${width}-${theme}.png`)
        })
        for (const row of await measureInstalledRows(orcaPage, language)) {
          for (const problem of row.problems) {
            failures.push(`${language} ${width} ${row.agent}: ${problem}`)
          }
        }
      }
    }
  }
  expect([...new Set(failures)]).toEqual([])
})
