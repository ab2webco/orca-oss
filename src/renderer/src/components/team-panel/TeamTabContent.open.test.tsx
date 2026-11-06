// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))
const openTeamSession = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./team-session-open', () => ({ openTeamSession }))

const { TeamTabContent } = await import('./TeamTabContent')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  openTeamSession.mockClear()
})

const lead = {
  paneKey: 'tab-lead:leaf',
  terminalHandle: 'term-lead',
  worktreeId: 'wt-main',
  host: { kind: 'local' },
  name: 'Castle',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null
} as unknown as TeamLeadCard

const knight = {
  paneKey: 'tab-7:leaf',
  terminalHandle: 'term-7',
  worktreeId: 'wt-7',
  host: { kind: 'local' },
  name: 'Knight',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null,
  ticket: { identifier: 'ORCA-1044', title: null, url: null, statusGroup: null },
  pr: null,
  needsYou: false
} as unknown as TeamMemberCard

async function render(look: 'game' | 'plain'): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const model = { kind: 'team', lead, advisor: null, members: [knight], xp: null, stopped: null }
  await act(async () => {
    root.render(
      <TeamTabContent
        model={model as unknown as TeamPanelGameModel}
        look={look}
        selectTab={vi.fn()}
        now={0}
      />
    )
  })
  return container
}

const click = async (element: Element | null | undefined): Promise<void> => {
  expect(element).toBeTruthy()
  await act(async () => (element as HTMLElement).click())
}
const buttonNamed = (container: HTMLElement, name: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find((one) => one.textContent === name)

describe('TeamTabContent opens sessions in the center', () => {
  it("opens a member's own terminal from its expanded card, by the name the card shows", async () => {
    const container = await render('plain')
    expect(buttonNamed(container, 'Open terminal')).toBeUndefined()

    await click(container.querySelector('[data-team-card="member"] button'))
    await click(buttonNamed(container, 'Open terminal'))

    expect(openTeamSession).toHaveBeenCalledWith(knight, 'ORCA-1044')
  })

  it("opens the lead's terminal from the lead card", async () => {
    const container = await render('game')

    await click(container.querySelector('[data-team-card="lead"] button'))

    expect(openTeamSession).toHaveBeenCalledWith(lead, 'Castle')
  })
})
