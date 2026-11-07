// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bars, Blocks, LineChart, SegmentNumber } from './team-display-figures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
})

async function render(node: React.JSX.Element): Promise<HTMLElement> {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(node))
  return container
}

const litSegments = (container: HTMLElement): number[] =>
  [...container.querySelectorAll('svg')].map(
    (digit) => digit.querySelectorAll('polygon.fill-current').length
  )

describe('SegmentNumber', () => {
  it('draws each digit with its own segments and reads the whole number', async () => {
    const container = await render(<SegmentNumber value={18} prefix="$" unit="%" />)

    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('$18%')
    // 1 lights b and c; 8 lights all seven.
    expect(litSegments(container)).toEqual([2, 7])
  })

  it('draws dashes and reads "No data" when Orca has no figure', async () => {
    const container = await render(<SegmentNumber value={null} unit="%" />)

    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('No data')
    expect(litSegments(container)).toEqual([1, 1])
    expect(container.textContent).not.toContain('%')
  })

  it('keeps a single digit in the ones place and marks an alert', async () => {
    const container = await render(<SegmentNumber value={3} alert />)

    expect(litSegments(container)).toEqual([0, 5])
    expect(container.querySelector('.text-status-attention')).not.toBeNull()
  })
})

describe('Bars', () => {
  it('scales each column to the peak and lights only the last', async () => {
    const container = await render(<Bars values={[0, 5, 10]} />)
    const columns = [...container.querySelectorAll('i')]

    expect(columns.map((one) => one.style.height)).toEqual(['6%', '50%', '100%'])
    expect(columns.map((one) => one.classList.contains('bg-foreground'))).toEqual([
      false,
      false,
      true
    ])
  })
})

describe('Blocks', () => {
  const lit = (container: HTMLElement, tone: string): number =>
    container.querySelectorAll(`i.${tone}`).length

  it('lights twelfths of the percent, at least one above zero', async () => {
    expect(lit(await render(<Blocks percent={50} />), 'bg-foreground')).toBe(6)
    expect(lit(await render(<Blocks percent={2} />), 'bg-foreground')).toBe(1)
    expect(lit(await render(<Blocks percent={0} />), 'bg-foreground')).toBe(0)
    expect(lit(await render(<Blocks percent={null} />), 'bg-foreground')).toBe(0)
  })

  it('turns amber when hot', async () => {
    expect(lit(await render(<Blocks percent={90} hot />), 'bg-status-warning')).toBe(11)
  })
})

describe('LineChart', () => {
  it('spans the lowest to the highest value across the width', async () => {
    const container = await render(<LineChart values={[2, 6, 4]} />)

    expect(container.querySelector('polyline')?.getAttribute('points')).toBe('0,42 100,4 200,23')
  })
})
