import { describe, expect, it } from 'vitest'
import { createE2EConfig } from './e2e-config'

describe('createE2EConfig showInactive', () => {
  it('defaults to a hidden window', () => {
    expect(createE2EConfig({ headless: true }).showInactive).toBe(false)
  })

  it('maps the window only for a headless run that opts in', () => {
    expect(createE2EConfig({ headless: true, showInactive: true }).showInactive).toBe(true)
  })

  it('ignores the opt-in outside headless runs, which already show the window', () => {
    expect(createE2EConfig({ headless: false, showInactive: true }).showInactive).toBe(false)
  })
})
