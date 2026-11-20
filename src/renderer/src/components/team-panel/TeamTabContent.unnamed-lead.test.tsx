// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamLeadCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  getIntlLocale: () => 'en'
}))
vi.mock('./team-session-open', () => ({ openTeamSession: vi.fn(async () => {}) }))
const { sendToLead } = vi.hoisted(() => ({ sendToLead: vi.fn(async () => true) }))
const { useTeamLeadPrompt } = vi.hoisted(() => ({
  useTeamLeadPrompt: vi.fn((): typeof sendToLead | null => sendToLead)
}))
vi.mock('./use-team-lead-prompt', () => ({ useTeamLeadPrompt }))

const { TeamTabContent } = await import('./TeamTabContent')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  sendToLead.mockClear()
  useTeamLeadPrompt.mockReturnValue(sendToLead)
})

const leadWith = (isNameDefault: boolean): TeamLeadCard =>
  ({
    paneKey: 'tab-lead:leaf',
    terminalHandle: 'term-lead',
    worktreeId: 'wt-main',
    host: { kind: 'local' },
    name: 'Lead',
    isNameDefault,
    status: 'working',
    condition: 'working',
    since: null,
    liveAction: null,
    model: null
  }) as unknown as TeamLeadCard

async function render(lead: TeamLeadCard): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const model = { kind: 'team', lead, advisor: null, members: [], xp: null, stopped: null }
  await act(async () => {
    root.render(
      <TeamTabContent
        model={model as unknown as TeamPanelGameModel}
        look="game"
        selectTab={vi.fn()}
        now={0}
        onOpenTasks={vi.fn()}
      />
    )
  })
  return container
}

// ORCA-1304: an unnamed lead is "Lead" and the card offers the setup that names it.
describe('the lead card of a lead with no name', () => {
  it('offers the setup, which asks the name', async () => {
    const container = await render(leadWith(true))
    const row = container.querySelector<HTMLElement>('[data-team-lead-unnamed]')!
    expect(row.textContent).toContain('no name yet')
    // Why: "Lead" beside the "Lead" badge reads twice.
    expect(container.querySelector('[data-team-name]')).toBeNull()
    await act(async () => row.querySelector('button')!.click())
    expect(sendToLead).toHaveBeenCalledWith('setup', '/orca-game:setup', 'Name your lead')
  })

  it('shows nothing once the lead is named', async () => {
    const container = await render(leadWith(false))
    expect(container.querySelector('[data-team-lead-unnamed]')).toBeNull()
    expect(container.querySelector('[data-team-name]')?.textContent).toBe('Lead')
  })

  it('shows nothing while there is no lead pane to send the setup to', async () => {
    useTeamLeadPrompt.mockReturnValue(null)
    expect((await render(leadWith(true))).querySelector('[data-team-lead-unnamed]')).toBeNull()
  })
})
