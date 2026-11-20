import { createRequire } from 'node:module'
const require = createRequire('/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/package.json')
const { chromium } = require('playwright')
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const theme of ['light', 'dark']) for (const w of [219, 320, 350, 760]) {
  const page = await browser.newPage({ viewport: { width: w + 40, height: 1200 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`file://${dir}index.html?theme=${theme}&w=${w}`)
  await page.waitForFunction(() => window.done, null, { timeout: 30000 }).catch(() => {})
  const name = `office3d-5a-${w === 760 ? 'large' : 'panel' + w}-${theme}.png`
  await page.locator('canvas').screenshot({ path: dir + 'out/' + name })
  console.log(name, JSON.stringify(errors))
  await page.close()
}
await browser.close()
