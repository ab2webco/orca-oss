// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamCondition } from '../../../../shared/team-panel-model-types'
import { TeamMemberRemoveAction } from './TeamMemberRemoveAction'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))
const send = vi.fn(async () => true)
let lead: typeof send | null = send
vi.mock('./use-team-lead-prompt', () => ({ useTeamLeadPrompt: () => lead }))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
  send.mockClear()
  lead = send
})

async function render(paneKey: string, condition: TeamCondition = 'idle') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () =>
    root.render(<TeamMemberRemoveAction card={{ paneKey, name: 'Ginebra', condition }} />)
  )
  return container
}

const click = (button: Element | null | undefined) =>
  act(async () => (button as HTMLButtonElement).click())
const buttonNamed = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((one) => one.textContent === text)

// Why confirm first: Remove stops a live session, and one click must not end a member (ORCA-1476).
describe('TeamMemberRemoveAction', () => {
  it('asks first, then has the lead remove this member by its dispatch id', async () => {
    const container = await render('remote:ctx_1177')

    await click(container.querySelector('[data-team-remove]'))
    expect(send).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Remove Ginebra? Orca stops its session if it runs')

    await click(buttonNamed(container, 'Remove'))
    expect(send).toHaveBeenCalledWith(
      'remove:remote:ctx_1177',
      'Remove the member Ginebra with `orca game remove ctx_1177` and tell me only the result.',
      'Remove Ginebra'
    )
    expect(container.querySelector('[data-team-remove-confirm]')).toBeNull()
  })

  it('sends nothing on Cancel, and names a local member by its pane key', async () => {
    const container = await render('tab-1:leaf-1')

    await click(container.querySelector('[data-team-remove]'))
    await click(buttonNamed(container, 'Cancel'))
    expect(send).not.toHaveBeenCalled()

    await click(container.querySelector('[data-team-remove]'))
    await click(buttonNamed(container, 'Remove'))
    expect(send).toHaveBeenCalledWith(
      'remove:tab-1:leaf-1',
      expect.stringContaining('`orca game remove tab-1:leaf-1`'),
      'Remove Ginebra'
    )
  })

  it('is not offered on a paused or queued card, which no fleet row backs', async () => {
    expect((await render('paused:ORCA-1', 'paused')).querySelector('[data-team-remove]')).toBeNull()
    expect((await render('queued:ORCA-2', 'queued')).querySelector('[data-team-remove]')).toBeNull()
  })

  it('is not offered without a lead pane to run it', async () => {
    lead = null
    const container = await render('tab-1:leaf-1')

    expect(container.querySelector('[data-team-remove]')).toBeNull()
  })
})
