// Screenshots of the built site at 1440/768/390/320 in light and dark, into .shots/.
// Fails when any page scrolls horizontally. Playwright comes from the repo root's
// node_modules (the desktop app's dev dependency), so site/ does not install it again.
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE } from '../site.config.mjs'

const SITE_DIR = fileURLToPath(new URL('../', import.meta.url))
const DIST = path.join(SITE_DIR, 'dist')
const OUT = path.join(SITE_DIR, '.shots')
const require = createRequire(path.join(SITE_DIR, '..', 'package.json'))
const { chromium } = require('@playwright/test')

const WIDTHS = [1440, 768, 390, 320]
const THEMES = ['dark', 'light']
const DOCS = [
  'get-started',
  'install',
  'orchestrator/orca-game',
  'cli/overview',
  'extend/plugins',
  'ssh'
]
const PAGES = [
  { name: 'landing', path: '/' },
  { name: 'landing-es', path: '/es/' },
  ...DOCS.flatMap((doc) => [
    { name: `docs-${doc.replace(/\//g, '-')}`, path: `/docs/${doc}/` },
    { name: `docs-es-${doc.replace(/\//g, '-')}`, path: `/es/docs/${doc}/` }
  ])
]
const EXTRA = [{ name: '404', path: '/404.html', width: 1440, theme: 'dark' }]
const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.xml': 'application/xml'
}

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${BASE}/`)) {
      res.writeHead(404).end()
      return
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname.slice(BASE.length)))
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = path.join(file, 'index.html')
    }
    if (!existsSync(file)) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function shoot(browser, origin, { name, path: pagePath, width, theme }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
  await context.addInitScript((t) => localStorage.setItem('starlight-theme', t), theme)
  const page = await context.newPage()
  await page.goto(`${origin}${BASE}${pagePath}`, { waitUntil: 'networkidle' })
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
  const file = path.join(OUT, `${name}-${theme}-${width}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await context.close()
  return { file, ...overflow, ok: overflow.scrollWidth <= overflow.clientWidth }
}

if (!existsSync(path.join(DIST, 'index.html'))) {
  process.stderr.write('dist/ is missing; run `pnpm build` first\n')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
const server = await serve()
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
const jobs = [
  ...PAGES.flatMap((p) =>
    THEMES.flatMap((theme) => WIDTHS.map((width) => ({ ...p, theme, width })))
  ),
  ...EXTRA
]
const failures = []
try {
  for (const job of jobs) {
    const result = await shoot(browser, origin, job)
    const rel = path.relative(SITE_DIR, result.file)
    process.stdout.write(
      `${result.ok ? 'ok  ' : 'FAIL'} ${rel} scrollWidth=${result.scrollWidth} clientWidth=${result.clientWidth}\n`
    )
    if (!result.ok) {
      failures.push(rel)
    }
  }
} finally {
  await browser.close()
  server.close()
}
process.stdout.write(`shots: ${jobs.length} captured, ${failures.length} with horizontal scroll\n`)
process.exit(failures.length ? 1 : 0)
