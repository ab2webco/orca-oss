// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaActionSettingsRow, ProjectActionRow } from './GameActionRows'
import type { ActionDraft } from './orchestrator-game-action-drafts'
import type { OrcaActionRow } from './orchestrator-game-action-list'

const DRAFT: ActionDraft = {
  label: 'Board',
  command: 'board',
  key: '',
  kind: 'mcp',
  prompt: '',
  server: 'plane',
  tool: 'list',
  args: '',
  icon: 'tag',
  pin: false
}

const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(node))
  return container
}

const text = (container: HTMLElement) => container.textContent?.replace(/\s+/g, ' ').trim()
const byLabel = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

describe('ProjectActionRow', () => {
  it('shows what the action runs and where it is set, and hands each control back', () => {
    const on = { onUp: vi.fn(), onEdit: vi.fn(), onPin: vi.fn() }
    const container = render(
      <ProjectActionRow draft={DRAFT} first={false} source="orca.yaml" {...on} />
    )
    expect(text(container)).toContain('Board/board · MCP plane')
    expect(text(container)).toContain('orca.yaml')
    act(() => byLabel(container, 'Move Board up').click())
    act(() =>
      [...container.querySelectorAll('button')].find((one) => one.textContent === 'Edit')!.click()
    )
    act(() => byLabel(container, 'Show Board in the row').click())
    expect([on.onUp, on.onEdit, on.onPin].map((one) => one.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('cannot move the first row up, and names a prompt action by the lead', () => {
    const container = render(
      <ProjectActionRow
        draft={{ ...DRAFT, kind: 'prompt', command: '' }}
        first
        source="settings"
        onUp={vi.fn()}
        onEdit={vi.fn()}
        onPin={vi.fn()}
      />
    )
    expect(byLabel(container, 'Move Board up').disabled).toBe(true)
    expect(text(container)).toContain('BoardAsk the lead')
  })
})

describe('OrcaActionSettingsRow', () => {
  const row = (overrides: Partial<OrcaActionRow>): OrcaActionRow => ({
    id: 'wave',
    label: 'Wave',
    icon: 'launch',
    prompt: '',
    enabled: true,
    ...overrides
  })

  it('says when an Orca action applies and turns it off', () => {
    const onToggle = vi.fn()
    const container = render(
      <OrcaActionSettingsRow row={row({})} onEdit={vi.fn()} onToggle={onToggle} />
    )
    expect(text(container)).toContain('When there is To Do and free slots.')
    act(() => byLabel(container, 'Turn on Wave').click())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('draws no switch on Stop', () => {
    const container = render(
      <OrcaActionSettingsRow
        row={row({ id: 'stop', label: 'Stop', icon: 'stop' })}
        onEdit={vi.fn()}
        onToggle={vi.fn()}
      />
    )
    expect(text(container)).toContain('Always, with confirmation.')
    expect(container.querySelector('[role="switch"]')).toBeNull()
  })
})
