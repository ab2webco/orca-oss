import { createRequire } from 'node:module'
const require = createRequire('/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/package.json')
const { chromium } = require('playwright')
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const theme of ['light', 'dark']) for (const floor of ['m2-studio', '', 'gpu-box']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`file://${dir}office-phone-band-demo.html?theme=${theme}&still=9`)
  await page.waitForFunction(() => window.done)
  await page.evaluate((k) => window.pick(k), floor)
  await page.waitForTimeout(300)
  const name = `phone-390-${floor || 'lead'}-${theme}.png`
  await page.screenshot({ path: dir + name })
  console.log(name, JSON.stringify(errors))
  await page.close()
}
await browser.close()
