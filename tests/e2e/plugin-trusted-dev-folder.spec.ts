/**
 * Invariants (ORCA-554):
 * - A dev plugin whose worker was running comes back on its own after a refresh
 *   replaces its spec, while it is still approved.
 * - A dev folder trusted from Settings > Plugins keeps its plugin approved across
 *   content edits; an untrusted folder with the same edit goes back to review.
 * Needs E2E: the trust travels checkbox → settings → main refresh → discovery,
 * and the restart is the real worker host, not a fake factory.
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const SCREENSHOT_WIDTHS = [1440, 768, 390, 320]

function automationManifest(id: string) {
  return {
    manifestVersion: 1,
    id,
    publisher: 'orca-samples',
    name: id,
    version: '1.0.0',
    engines: { orca: '>=1.4.0' },
    pluginApi: 1,
    contributes: {
      automations: [
        { id: 'tick', title: 'Tick', trigger: '0 3 * * *', timezone: 'UTC', command: 'true' }
      ]
    }
  }
}

async function openPluginSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'plugins', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.locator('[data-settings-section="plugins"]')).toBeVisible()
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function pluginStatus(page: Page, pluginKey: string): Promise<string> {
  return page.evaluate(
    async (key) =>
      (await window.api.plugins.list()).find((entry) => entry.pluginKey === key)?.status ??
      'missing',
    pluginKey
  )
}

async function approve(page: Page, pluginKey: string): Promise<void> {
  await page.evaluate(async (key) => {
    const entry = (await window.api.plugins.list()).find((candidate) => candidate.pluginKey === key)
    if (!entry?.consentFingerprint) {
      throw new Error(`no consent fingerprint for ${key}`)
    }
    await window.api.plugins.consent({
      pluginKey: key,
      reviewedFingerprint: entry.consentFingerprint,
      decision: 'approve'
    })
  }, pluginKey)
}

async function editContent(root: string): Promise<void> {
  await writeFile(join(root, 'README.md'), `edited ${Date.now()}\n`)
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
}

test('restarts a running dev plugin worker after a refresh replaces it', async ({ orcaPage }) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-restart-e2e-'))
  const pluginRoot = join(tempRoot, 'hello-orca')
  const pluginKey = 'orca-samples.hello-orca'
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })

  try {
    await orcaPage.evaluate(async (root) => {
      const settings = await window.api.settings.set({
        pluginSystemEnabled: true,
        devPluginPaths: [root]
      })
      window.__store?.setState({ settings })
      await window.api.plugins.refresh()
    }, pluginRoot)
    await approve(orcaPage, pluginKey)
    expect(await pluginStatus(orcaPage, pluginKey)).toBe('idle')
    await orcaPage.evaluate(
      async (key) => window.api.plugins.invokeCommand({ pluginKey: key, commandId: 'hello-ping' }),
      pluginKey
    )
    expect(await pluginStatus(orcaPage, pluginKey)).toBe('running')

    const manifestPath = join(pluginRoot, 'orca-plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string }
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: '1.0.1' }, null, 2))
    await orcaPage.evaluate(async () => {
      await window.api.plugins.refresh()
    })

    // Nothing invokes the plugin after the refresh: only the restore can bring it back.
    await expect.poll(() => pluginStatus(orcaPage, pluginKey), { timeout: 15_000 }).toBe('running')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('keeps a trusted dev folder approved across edits and re-reviews an untrusted one', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-trust-e2e-'))
  const trustedRoot = join(tempRoot, 'trusted-sync')
  const untrustedRoot = join(tempRoot, 'untrusted-sync')
  for (const root of [trustedRoot, untrustedRoot]) {
    await mkdir(root, { recursive: true })
    const id = root === trustedRoot ? 'trusted-sync' : 'untrusted-sync'
    await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(automationManifest(id)))
  }

  try {
    await orcaPage.evaluate(
      async (roots) => {
        const settings = await window.api.settings.set({
          pluginSystemEnabled: true,
          devPluginPaths: roots
        })
        window.__store?.setState({ settings })
        await window.api.plugins.refresh()
      },
      [trustedRoot, untrustedRoot]
    )

    await openPluginSettings(orcaPage)
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    await orcaPage.getByText('Development', { exact: true }).click()
    const trustToggle = orcaPage.getByRole('checkbox', {
      name: `Trust changes in this folder: ${trustedRoot}`
    })
    const untrustedToggle = orcaPage.getByRole('checkbox', {
      name: `Trust changes in this folder: ${untrustedRoot}`
    })
    await expect(trustToggle).toHaveAttribute('aria-checked', 'false')
    await expect(untrustedToggle).toHaveAttribute('aria-checked', 'false')

    await trustToggle.click()
    await expect
      .poll(() =>
        orcaPage.evaluate(async () => (await window.api.settings.get()).trustedDevPluginPaths)
      )
      .toEqual([trustedRoot])
    await expect(trustToggle).toHaveAttribute('aria-checked', 'true')

    await approve(orcaPage, 'orca-samples.trusted-sync')
    await approve(orcaPage, 'orca-samples.untrusted-sync')
    expect(await pluginStatus(orcaPage, 'orca-samples.trusted-sync')).toBe('idle')
    expect(await pluginStatus(orcaPage, 'orca-samples.untrusted-sync')).toBe('idle')

    await editContent(trustedRoot)
    await editContent(untrustedRoot)
    await orcaPage.evaluate(async () => {
      await window.api.plugins.refresh()
    })

    expect(await pluginStatus(orcaPage, 'orca-samples.untrusted-sync')).toBe('pending')
    expect(await pluginStatus(orcaPage, 'orca-samples.trusted-sync')).toBe('idle')

    const development = orcaPage.locator('details').filter({ hasText: trustedRoot })
    const fits: Record<string, string | number>[] = []
    for (const width of SCREENSHOT_WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        await development.scrollIntoViewIfNeeded()
        await expect(trustToggle).toBeVisible()
        const fit = await development.evaluate((node) => {
          const section = node.getBoundingClientRect()
          const toggle = node.querySelector('button[role="checkbox"]')!.getBoundingClientRect()
          // A long path must truncate, not set the narrowest width the section can take.
          const probe = node.cloneNode(true) as HTMLElement
          probe.style.width = 'min-content'
          probe.style.position = 'absolute'
          probe.style.visibility = 'hidden'
          node.parentElement!.appendChild(probe)
          const minContentWidth = Math.round(probe.getBoundingClientRect().width)
          probe.remove()
          return {
            minContentWidth,
            innerWidth: window.innerWidth,
            sectionRight: Math.round(section.right),
            toggleRight: Math.round(toggle.right)
          }
        })
        fits.push({ width, theme, ...fit })
        expect(fit.toggleRight, `trust toggle off-screen at ${width}px`).toBeLessThanOrEqual(
          fit.innerWidth
        )
        expect(
          fit.minContentWidth,
          `development section cannot shrink to ${width}px`
        ).toBeLessThanOrEqual(fit.innerWidth)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`development-${width}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
    await writeFile(testInfo.outputPath('fit.json'), JSON.stringify(fits, null, 2))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
