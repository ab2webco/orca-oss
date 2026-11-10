// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamPanelLoadingState } from './team-panel-section-state'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

describe('TeamPanelLoadingState', () => {
  it('pulses its skeleton rows, and holds them still under reduced motion', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<TeamPanelLoadingState rows={3} />))

    const rows = [...container.querySelectorAll('[aria-busy="true"] > div')]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.className).toContain('animate-pulse')
      expect(row.className).toContain('motion-reduce:animate-none')
    }
  })
})
