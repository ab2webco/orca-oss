import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOxlintPluginOnSource } from './oxlint-plugin-test-runner.mjs'

const pluginPath = path.resolve('config/oxlint-plugins/e2e-settings-write.mjs')

function lintSource(source) {
  return runOxlintPluginOnSource({
    pluginName: 'e2e-settings-write',
    pluginPath,
    source,
    extension: 'ts',
    rules: {
      'e2e-settings-write/no-held-write-in-evaluate': 'warn'
    }
  })
}

const violations = [
  [
    'awaited api write',
    'await page.evaluate(async (next) => { const settings = await window.api.settings.set({ theme: next }); window.__store?.setState({ settings }) }, theme)'
  ],
  [
    'awaited store write',
    'await page.evaluate(async () => { await window.__store!.getState().updateSettings({ theme: "dark" }) })'
  ],
  [
    'optional store write',
    'await page.evaluate(async () => { await window.__store?.getState().updateSettings({ theme: "dark" }) })'
  ],
  [
    'write returned from an arrow body',
    'await page.evaluate(() => window.__store!.getState().updateSettings({ theme: "dark" }))'
  ],
  [
    'write returned from a block',
    'await orcaPage.evaluate(() => { return window.api.settings.set({ theme: "dark" }) })'
  ],
  [
    'write returned through then',
    'await page.evaluate(() => window.api.settings.set({ theme: "dark" }).then(() => true))'
  ],
  [
    'state alias',
    'await page.evaluate(async () => { const state = window.__store!.getState(); await state.updateSettings({ theme: "dark" }) })'
  ],
  [
    'nested in a condition',
    'await page.evaluate(async (on) => { if (on) { await window.api.settings.set({ theme: "dark" }) } }, true)'
  ],
  [
    'evaluateHandle',
    'await page.evaluateHandle(async () => { await window.api.settings.set({ theme: "dark" }) })'
  ]
]

const accepted = [
  [
    'started, not held',
    'await page.evaluate((next) => { void window.__store!.getState().updateSettings(next).then(() => { done = true }); return 1 }, {})'
  ],
  [
    'not inside an evaluate',
    'async function f() { await store.updateSettings({ theme: "dark" }) }'
  ],
  [
    'a read inside an evaluate',
    'await page.evaluate(async () => { await window.api.settings.get() })'
  ],
  ['another api set', 'await page.evaluate(async () => { await window.api.ui.set({ a: 1 }) })']
]

describe('e2e-settings-write/no-held-write-in-evaluate', () => {
  it.each(violations)('flags %s', (_name, source) => {
    const diagnostics = lintSource(source)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].message).toContain('writeSettings')
  })

  it.each(accepted)('accepts %s', (_name, source) => {
    expect(lintSource(source)).toEqual([])
  })
})
