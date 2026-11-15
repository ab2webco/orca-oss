import { writeFile } from 'node:fs/promises'
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES } from './helpers/settings-window'
import { openOfficeTeam, type SeededMember } from './helpers/team-office-seed'

// Why opt-in: captures at every width and theme outrun the CI budget.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
// Office's figures: feet 36 px over the stage's bottom plus 22 px of depth; seats at depth 0.55.
const STAGE_HEIGHT = 176
const OVER_FEET_PX = 16
const pointY = (depth: number): number => STAGE_HEIGHT - 36 + depth * 22 - OVER_FEET_PX

// Why five machines: past VIEW_FLOORS=3 the building scrolls, so the handle has floors to show.
const MEMBERS: SeededMember[] = [
  { name: 'Mario · ORCA-501 Code', state: 'working' },
  { name: 'Luigi · ORCA-502 Code', state: 'idle' },
  { name: 'Peach · ORCA-503 Code', state: 'working', host: 'm1' },
  { name: 'Toad · ORCA-504 Docs', state: 'working', host: 'imac' },
  { name: 'Yoshi · ORCA-505 Code', state: 'working', host: 'contabo' },
  { name: 'Daisy · ORCA-506 Code', state: 'working', host: 'mbp' }
]

/** Moves the pointer over `key`'s figure on `floor`, read from where the scene seats it. */
async function hoverMember(page: Page, floor: Locator, key: string): Promise<void> {
  const stage = floor.locator('[data-scene-seats]').first()
  const seats = (await stage.getAttribute('data-scene-seats')) ?? ''
  const x = Number(
    seats
      .split(' ')
      .find((one) => one.startsWith(`${key}@`))
      ?.split('@')[1]
  )
  expect(Number.isFinite(x), `${key} has no seat on this floor (${seats})`).toBe(true)
  const canvas = await stage.locator('canvas').boundingBox()
  await page.mouse.move(canvas!.x + x * canvas!.width, canvas!.y + pointY(0.55))
}

// Why test.use: a never-shown window paints about once a second on CI, too sparse to hover.
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

// ORCA-1219: the building stopped at three floors, and nothing said which character was whom.
test('the Office building resizes to every floor, and a character names its agent both ways with its row', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: MEMBERS })
  try {
    const out = (name: string) => testInfo.outputPath(name)
    const panel = orcaPage.getByTestId('team-panel')
    const building = panel.locator('[data-team-building]')
    const scroller = building.locator('[data-team-floors-scroll]')
    const handle = building.getByRole('separator', { name: 'Resize building' })
    await expect(building.locator('[data-team-floor]')).toHaveCount(5, { timeout: 60_000 })
    await orcaPage.waitForTimeout(6000)

    // At its minimum the building shows three floors and scrolls, as before.
    const floorsShown = () =>
      scroller.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    const atMin = await floorsShown()
    expect(atMin.scroll, 'the building does not scroll at its minimum').toBeGreaterThan(
      atMin.client
    )
    await building.screenshot({ path: out('building-min.png') })

    // Dragged down, it grows to every floor and stops there.
    const box = (await handle.boundingBox())!
    await orcaPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(box.x + box.width / 2, box.y + 2000, { steps: 8 })
    await orcaPage.mouse.up()
    const dragged = await floorsShown()
    expect(dragged.client, 'the dragged building still hides a floor').toBeGreaterThanOrEqual(
      dragged.scroll
    )
    await expect(handle).toHaveAttribute(
      'aria-valuenow',
      (await handle.getAttribute('aria-valuemax')) ?? ''
    )
    // Why: the pitch once added a slab inside each floor's height; a band showed under the last.
    const band = await scroller.evaluate((el) => {
      const last = [...el.querySelectorAll('[data-team-floor]')].at(-1)!
      return el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom
    })
    expect(band, 'an empty band under the ground floor at full height').toBeLessThanOrEqual(1)
    await building.screenshot({ path: out('building-all-floors.png') })

    // A double click resets it; the keyboard moves it a floor at a time.
    await handle.dblclick()
    await expect.poll(async () => (await floorsShown()).client).toBe(atMin.client)
    await handle.focus()
    await orcaPage.keyboard.press('ArrowDown')
    await expect.poll(async () => (await floorsShown()).client).toBeGreaterThan(atMin.client)

    // Hovering a character names it and lights its row; on this machine and on m1.
    for (const [floorKey, key, name] of [
      ['', 'office:0', 'Mario'],
      ['m1', 'office:2', 'Peach']
    ] as const) {
      const floor = building.locator(`[data-team-floor="${floorKey}"]`)
      await floor.scrollIntoViewIfNeeded()
      await hoverMember(orcaPage, floor, key)
      const label = floor.locator(`[data-scene-who="${key}"]`)
      await expect(label, `no label over ${name}`).toBeVisible({ timeout: 10_000 })
      await expect(label).toContainText(name)
      await expect(
        panel.locator(`[data-team-card="member"][data-pane-key="${key}"]`)
      ).toHaveAttribute('data-team-card-lit', '')
      await building.screenshot({ path: out(`hover-${floorKey || 'local'}.png`) })
    }

    // And back: hovering a row lights its character in the scene.
    await orcaPage.mouse.move(0, 0)
    const row = panel.locator('[data-team-card="member"][data-pane-key="office:1"]')
    await row.scrollIntoViewIfNeeded()
    await row.hover()
    await expect(building.locator('[data-scene-who="office:1"]')).toBeVisible({ timeout: 10_000 })
    await writeFile(out('heights.json'), JSON.stringify({ atMin, dragged }))

    if (!CAPTURE_EVIDENCE) {
      return
    }
    for (const [windowWidth, sidebar] of [
      [1440, 640],
      [390, 0]
    ] as const) {
      await setWindowWidth(electronApp, orcaPage, windowWidth)
      if (sidebar) {
        await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), sidebar)
      }
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(1000)
        const name = `${windowWidth}-${sidebar || 'min'}-${theme}`
        await handle.dblclick()
        await building.screenshot({ path: out(`building-min-${name}.png`) })
        await handle.focus()
        await orcaPage.keyboard.press('End')
        await orcaPage.waitForTimeout(400)
        await building.screenshot({ path: out(`building-all-${name}.png`) })
        for (const [floorKey, key] of [
          ['', 'office:0'],
          ['m1', 'office:2']
        ] as const) {
          await hoverMember(orcaPage, building.locator(`[data-team-floor="${floorKey}"]`), key)
          await orcaPage.waitForTimeout(400)
          await building.screenshot({ path: out(`hover-${floorKey || 'local'}-${name}.png`) })
        }
      }
    }
  } finally {
    dispose()
  }
})
