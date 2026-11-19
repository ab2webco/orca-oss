// Screenshots of the built site at 1440/768/390/320 in light and dark, into .shots/.
// Fails when any page scrolls horizontally, or when the landing's hero runs past the 1440x900 first
// screen; arguments keep only the pages whose name contains one.
// Playwright comes from the repo root's node_modules (the desktop app's dev dependency), so site/
// does not install it again.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { serveDist, SITE_DIR } from './dist-server.mjs'

const OUT = path.join(SITE_DIR, '.shots')
const require = createRequire(path.join(SITE_DIR, '..', 'package.json'))
const { chromium } = require('@playwright/test')

const WIDTHS = [1440, 768, 390, 320]
const THEMES = ['dark', 'light']
const DOCS = [
  'get-started',
  'install',
  'projects',
  'one-agent',
  'review/linear',
  'orchestrator/orca-game',
  'cli/overview',
  'plugins-and-skills',
  'extend/plugins',
  'ssh',
  'agents/agent-teams',
  'agents/scenes-and-settings',
  'agents/usage-tracking',
  'model/sidebar',
  'terminal',
  'mobile',
  'artifacts-and-automations',
  'settings-and-troubleshooting'
]
const PAGES = [
  { name: 'landing', path: '/' },
  { name: 'landing-es', path: '/es/' },
  { name: 'docs-index', path: '/docs/' },
  { name: 'docs-es-index', path: '/es/docs/' },
  ...DOCS.flatMap((doc) => [
    { name: `docs-${doc.replace(/\//g, '-')}`, path: `/docs/${doc}/` },
    { name: `docs-es-${doc.replace(/\//g, '-')}`, path: `/es/docs/${doc}/` }
  ])
]
const EXTRA = [{ name: '404', path: '/404.html', width: 1440, theme: 'dark' }]
async function shoot(browser, origin, { name, path: pagePath, width, theme }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
  await context.addInitScript((t) => localStorage.setItem('starlight-theme', t), theme)
  const page = await context.newPage()
  await page.goto(`${origin}${pagePath}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  // Walk the page so scroll-triggered reveals and lazy images settle before the capture.
  // Why instant: the landing sets scroll-behavior: smooth, which would swallow each step.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((r) => setTimeout(r, 80))
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
  })
  await page.waitForTimeout(900)
  const overflow = await page.evaluate(() => {
    // Why: the landing clips x-overflow on body; lift it so clipped content still counts.
    document.body.style.overflowX = 'visible'
    const doc = document.documentElement
    const measured = {
      scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
      clientWidth: doc.clientWidth
    }
    document.body.style.overflowX = ''
    return measured
  })
  const heroEnd = await page.evaluate(() =>
    Math.round(document.querySelector('.hero')?.getBoundingClientRect().bottom ?? 0)
  )
  // Why from 1440 only: below it the clip stacks under the copy and the hero is taller than a phone.
  const heroFits = width < 1440 || heroEnd <= 900
  const file = path.join(OUT, `${name}-${theme}-${width}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await context.close()
  return {
    file,
    ...overflow,
    heroEnd,
    ok: overflow.scrollWidth <= overflow.clientWidth && heroFits
  }
}

const server = await serveDist()
mkdirSync(OUT, { recursive: true })
const { origin } = server
const browser = await chromium.launch()
const only = process.argv.slice(2)
const picked = PAGES.filter((p) => !only.length || only.some((part) => p.name.includes(part)))
const jobs = [
  ...picked.flatMap((p) =>
    THEMES.flatMap((theme) => WIDTHS.map((width) => ({ ...p, theme, width })))
  ),
  ...(only.length ? [] : EXTRA)
]
const failures = []
try {
  for (const job of jobs) {
    const result = await shoot(browser, origin, job)
    const rel = path.relative(SITE_DIR, result.file)
    process.stdout.write(
      `${result.ok ? 'ok  ' : 'FAIL'} ${rel} scrollWidth=${result.scrollWidth} clientWidth=${result.clientWidth}${result.heroEnd ? ` heroEnd=${result.heroEnd}` : ''}\n`
    )
    if (!result.ok) {
      failures.push(rel)
    }
  }
} finally {
  await browser.close()
  server.close()
}
process.stdout.write(
  `shots: ${jobs.length} captured, ${failures.length} with horizontal scroll or a landing hero past the 1440x900 fold\n`
)
process.exit(failures.length ? 1 : 0)
