/**
 * ORCA-1216 §8: with two hosts and a host filter, scrolled mid-list, the host card and the
 * project header pin as one opaque stack: nothing between them and no row through them.
 */

import type { Page } from '@stablyai/playwright-test'
import { PNG } from 'pngjs'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'
import {
  seedPairedHostSidebar,
  setSeededHostConnection,
  sshHostId,
  type SeededHostRepo
} from './helpers/paired-host-sidebar-fixture'

type StackProbe = {
  pinned: number
  hostBottom: number
  groupTop: number
  /** Background alpha of each pinned tier; below 1 the rows under it show through. */
  alphas: number[]
  leaks: { x: number; y: number; row: string }[]
}

const M1 = 'e2e-sticky-host'

// Why recent: an idle project folds to one row (ORCA-1216); this stack needs every row drawn.
const recentProjects = (prefix: string, count: number): SeededHostRepo[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `e2e-sticky-${prefix}-${index}`,
    displayName: `${prefix}-project-${index}`,
    workspaces: 3,
    activityAgeMs: 0
  }))

async function seedTwoHosts(page: Page): Promise<void> {
  await seedPairedHostSidebar(page, {
    local: recentProjects('local', 6),
    hosts: [{ connectionId: M1, label: 'm1', repos: recentProjects('remote', 3) }],
    visibleHostIds: ['local', sshHostId(M1)],
    // The owner's width.
    sidebarWidth: 470
  })
  await setSeededHostConnection(page, M1, 'connected')
}

async function probeStack(page: Page): Promise<StackProbe | null> {
  return page.evaluate(() => {
    const pinned = Array.from(
      document.querySelectorAll<HTMLElement>('[data-worktree-sticky-header-active]')
    )
    const host = pinned.find((element) => element.querySelector('[data-host-header-drag-id]'))
    const group = pinned.find((element) => element !== host)
    if (!host || !group) {
      return null
    }
    const hostRect = host.getBoundingClientRect()
    const groupRect = group.getBoundingClientRect()
    const leaks: { x: number; y: number; row: string }[] = []
    // Why from the scroll root's top: a row can also peek out above the pinned host card.
    const scrollRoot = document.querySelector<HTMLElement>('[data-worktree-sidebar]')
    const top = Math.min(hostRect.top, scrollRoot?.getBoundingClientRect().top ?? hostRect.top)
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = groupRect.left + groupRect.width * fraction
      for (let y = Math.ceil(top) + 1; y < groupRect.bottom - 1; y += 1) {
        const hit = document.elementFromPoint(x, y)
        if (!hit?.closest('[data-worktree-sticky-header-active]')) {
          const row = hit?.closest<HTMLElement>('[data-worktree-virtual-row]')
          leaks.push({ x, y, row: row?.dataset.worktreeVirtualRowKey ?? hit?.tagName ?? 'none' })
        }
      }
    }
    const alphas = [host, group].map((element) => {
      const match = getComputedStyle(element).backgroundColor.match(/rgba?\(([^)]+)\)/)
      const parts = match ? match[1].split(/[\s,/]+/).filter(Boolean) : []
      return parts.length === 4 ? Number(parts[3]) : match ? 1 : 0
    })
    return {
      pinned: pinned.length,
      hostBottom: hostRect.bottom,
      groupTop: groupRect.top,
      alphas,
      leaks
    }
  })
}

// Pixels inside the pinned stack that change when every unpinned row is hidden: rows painting
// through it. Catches the sub-pixel seams elementFromPoint cannot see.
async function countPixelsRowsPaintInStack(page: Page): Promise<number> {
  const clip = await page.evaluate(() => {
    const pinned = Array.from(
      document.querySelectorAll<HTMLElement>('[data-worktree-sticky-header-active]')
    ).map((element) => element.getBoundingClientRect())
    const top = Math.floor(Math.min(...pinned.map((rect) => rect.top)))
    const bottom = Math.ceil(Math.max(...pinned.map((rect) => rect.bottom)))
    const left = Math.ceil(Math.max(...pinned.map((rect) => rect.left)))
    const right = Math.floor(Math.min(...pinned.map((rect) => rect.right)))
    return { x: left, y: top, width: right - left, height: bottom - top }
  })
  const withRows = PNG.sync.read(await page.screenshot({ clip }))
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'e2e-hide-unpinned-rows'
    style.textContent =
      '[data-worktree-virtual-row]:not([data-worktree-sticky-header-active]){visibility:hidden!important}'
    document.head.append(style)
  })
  const withoutRows = PNG.sync.read(await page.screenshot({ clip }))
  await page.evaluate(() => document.getElementById('e2e-hide-unpinned-rows')?.remove())
  let differing = 0
  for (let index = 0; index < withRows.data.length; index += 4) {
    const delta = Math.max(
      Math.abs(withRows.data[index]! - withoutRows.data[index]!),
      Math.abs(withRows.data[index + 1]! - withoutRows.data[index + 1]!),
      Math.abs(withRows.data[index + 2]! - withoutRows.data[index + 2]!)
    )
    if (delta > 8) {
      differing += 1
    }
  }
  return differing
}

test('the pinned host card and project header stack with nothing between or through them', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  // The owner's appearance: the sidebar matches a terminal drawn at 80% opacity.
  await writeSettings(orcaPage, {
    theme: 'dark',
    leftSidebarAppearanceMode: 'match-terminal',
    terminalBackgroundOpacity: 0.8
  })
  // Why before seeding: it remounts the sidebar, and its bubble covered the last row in the capture.
  await dismissWorkspaceBoardMovedHint(orcaPage)
  await seedTwoHosts(orcaPage)

  const viewport = orcaPage.locator('[data-worktree-sidebar]')
  await expect(viewport.locator('[data-host-header-drag-id]')).toHaveCount(2, { timeout: 30_000 })

  const overflow = await viewport.evaluate((element) => element.scrollHeight - element.clientHeight)
  expect(overflow, 'the list does not overflow: the stack is never tested').toBeGreaterThan(200)

  // Why a sweep: a handoff between headers lasts a few pixels, so one offset can miss it.
  const failures: { scrollTop: number; probe: StackProbe }[] = []
  let pinnedOffsets = 0
  for (let scrollTop = 0; scrollTop <= overflow; scrollTop += 7) {
    await viewport.evaluate(async (element, top) => {
      element.scrollTop = top
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, scrollTop)
    const probe = await probeStack(orcaPage)
    if (!probe) {
      continue
    }
    pinnedOffsets += 1
    if (
      Math.abs(probe.groupTop - probe.hostBottom) >= 1 ||
      probe.leaks.length > 0 ||
      probe.alphas.some((alpha) => alpha < 1)
    ) {
      failures.push({ scrollTop, probe: { ...probe, leaks: probe.leaks.slice(0, 3) } })
    }
  }
  testInfo.annotations.push({
    type: 'sweep',
    description: JSON.stringify({ pinnedOffsets, failures: failures.slice(0, 5) })
  })
  if (failures[0]) {
    await viewport.evaluate((element, top) => {
      element.scrollTop = top
    }, failures[0].scrollTop)
    await orcaPage.screenshot({ path: testInfo.outputPath('sticky-stack-first-failure.png') })
  }
  expect(pinnedOffsets, 'the two tiers never pinned together').toBeGreaterThan(5)
  expect(failures, 'offsets where the stack has a gap or a row paints through it').toEqual([])

  await viewport.evaluate(async (element) => {
    element.scrollTop = Math.round(element.scrollHeight * 0.3)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await expect
    .poll(async () => (await probeStack(orcaPage))?.pinned ?? 0, {
      message: 'host card and project header never pinned together'
    })
    .toBe(2)
  const stack = await probeStack(orcaPage)
  await orcaPage.screenshot({ path: testInfo.outputPath('sticky-stack-scrolled.png') })
  testInfo.annotations.push({ type: 'stack probe', description: JSON.stringify(stack) })
  if (!stack) {
    throw new Error('the stack unpinned between the poll and the probe')
  }
  expect(
    Math.abs(stack.groupTop - stack.hostBottom),
    'gap or overlap between the tiers'
  ).toBeLessThan(1)
  expect(stack.leaks, 'rows paint inside the pinned stack').toEqual([])
  expect(await countPixelsRowsPaintInStack(orcaPage), 'row pixels show inside the stack').toBe(0)
})
