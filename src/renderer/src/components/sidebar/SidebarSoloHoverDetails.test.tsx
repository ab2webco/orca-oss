// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SidebarSoloHover } from './sidebar-solo-hover'
import { SidebarSoloHoverDetails } from './SidebarSoloHoverDetails'

vi.mock('./CacheTimer', () => ({
  default: ({ startedAt, ttlMs }: { startedAt: number; ttlMs: number }) => (
    <span data-cache-timer={`${startedAt}:${ttlMs}`} />
  )
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(
  hover: SidebarSoloHover,
  cacheTtlMs = 300_000,
  onOpen?: React.ComponentProps<typeof SidebarSoloHoverDetails>['onOpen']
): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(<SidebarSoloHoverDetails hover={hover} cacheTtlMs={cacheTtlMs} onOpen={onOpen} />)
  )
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const HOVER: SidebarSoloHover = {
  title: 'cin-1145',
  subtitle: 'cineco-orchestrator · imac',
  lines: [
    { kind: 'text', label: 'State', value: 'Needs you', asks: true },
    { kind: 'text', label: 'Prompt', value: 'Add booking validation' },
    { kind: 'cache', label: 'Cache', expiresAt: 400_000 }
  ]
}

describe('SidebarSoloHoverDetails', () => {
  it('draws the title, subtitle and each fact as a term and its value', () => {
    const el = render(HOVER)
    expect(el.querySelector('[data-solo-hover-title]')?.textContent).toBe('cin-1145')
    expect(el.querySelector('[data-solo-hover-subtitle]')?.textContent).toBe(
      'cineco-orchestrator · imac'
    )
    const terms = [...el.querySelectorAll('dt')].map((node) => node.textContent)
    expect(terms).toEqual(['State', 'Prompt', 'Cache'])
    expect(el.querySelectorAll('dd')[1]?.textContent).toBe('Add booking validation')
  })

  it('puts a line that asks in the question tone', () => {
    const state = render(HOVER).querySelectorAll('dd')[0]!
    expect(state.hasAttribute('data-asks')).toBe(true)
    expect(state.className).toContain('text-agent-question-text')
  })

  it('counts the cache down from when it was last warmed', () => {
    const timer = render(HOVER).querySelector('[data-cache-timer]')
    expect(timer?.getAttribute('data-cache-timer')).toBe('100000:300000')
  })

  it('drops the cache line when the timer has no length', () => {
    const el = render(HOVER, 0)
    expect([...el.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
      'State',
      'Prompt'
    ])
  })

  it('opens the PR and the ticket in Orca from their lines', () => {
    const pr = vi.fn()
    const lines: SidebarSoloHover['lines'] = [
      { kind: 'text', label: 'PR', value: '#912 · CI green', opens: 'pr' },
      { kind: 'text', label: 'Ticket', value: 'CIN-1145', opens: 'ticket' }
    ]
    const el = render({ ...HOVER, lines }, 300_000, { pr })
    const button = el.querySelector<HTMLButtonElement>('dd button')
    expect(button?.textContent).toBe('#912 · CI green')
    act(() => button?.click())
    expect(pr).toHaveBeenCalledTimes(1)
    // Why plain text: with no way to open it in Orca, a button would do nothing.
    expect(el.querySelectorAll('dd button')).toHaveLength(1)
    expect(el.querySelectorAll('dd')[1]?.textContent).toBe('CIN-1145')
  })

  it('has no subtitle line when there is none', () => {
    const el = render({ ...HOVER, subtitle: null })
    expect(el.querySelector('[data-solo-hover-subtitle]')).toBeNull()
  })
})
