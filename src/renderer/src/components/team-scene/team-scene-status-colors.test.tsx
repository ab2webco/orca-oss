// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STATUS_COLOR_DEFAULTS } from '@/lib/status-color-overrides'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'
import { readTeamSceneStatusColors, useTeamSceneStatusColors } from './team-scene-status-colors'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const root = document.documentElement

afterEach(() => {
  root.className = ''
  root.removeAttribute('style')
  document.getElementById('orca-status-colors')?.remove()
})

describe('readTeamSceneStatusColors', () => {
  it('takes each meaning from its ORCA-1070 tone token', () => {
    root.style.setProperty('--status-attention', '#aa0001')
    root.style.setProperty('--status-success', '#00aa02')
    root.style.setProperty('--status-info', '#0000a3')
    root.style.setProperty('--status-warning', '#aa7704')
    expect(readTeamSceneStatusColors()).toEqual({
      attention: '#aa0001',
      done: '#00aa02',
      working: '#0000a3',
      risk: '#aa7704'
    })
  })

  it("falls back to the theme's default tones when a token does not resolve", () => {
    root.classList.add('dark')
    expect(readTeamSceneStatusColors()).toEqual({
      attention: STATUS_COLOR_DEFAULTS.dark.attention,
      done: STATUS_COLOR_DEFAULTS.dark.success,
      working: STATUS_COLOR_DEFAULTS.dark.info,
      risk: STATUS_COLOR_DEFAULTS.dark.warning
    })
  })
})

describe('useTeamSceneStatusColors', () => {
  let host: HTMLDivElement
  let reactRoot: Root
  let seen: TeamSceneStatusColors[]

  function Probe(): null {
    seen.push(useTeamSceneStatusColors())
    return null
  }

  beforeEach(() => {
    seen = []
    host = document.createElement('div')
    document.body.append(host)
    reactRoot = createRoot(host)
  })
  afterEach(() => {
    act(() => reactRoot.unmount())
    host.remove()
  })

  it('re-reads the tones when the theme flips or a user override lands', async () => {
    act(() => reactRoot.render(<Probe />))
    expect(seen.at(-1)?.attention).toBe(STATUS_COLOR_DEFAULTS.light.attention)
    await act(async () => {
      root.classList.add('dark')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(seen.at(-1)?.attention).toBe(STATUS_COLOR_DEFAULTS.dark.attention)
    await act(async () => {
      const style = document.createElement('style')
      style.id = 'orca-status-colors'
      document.head.append(style)
      root.style.setProperty('--status-attention', '#ab0003')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(seen.at(-1)?.attention).toBe('#ab0003')
  })
})
