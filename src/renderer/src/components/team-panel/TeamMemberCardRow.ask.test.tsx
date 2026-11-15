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

const toadette = (ask: TeamMemberCard['ask']): TeamMemberCard =>
  ({
    paneKey: 'tab-1216:leaf',
    terminalHandle: 'term-1216',
    worktreeId: 'wt-1216',
    host: { kind: 'local' },
    name: 'Toadette',
    status: 'attention',
    condition: 'waiting',
    since: null,
    liveAction: { kind: 'tool', tool: 'Bash', detail: 'rm -f $D/*.png' },
    model: null,
    ticket: { identifier: 'ORCA-1216', title: null, url: null, statusGroup: null },
    pr: null,
    needsYou: true,
    ask
  }) as unknown as TeamMemberCard

async function render(member: TeamMemberCard) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const selectTab = vi.fn()
  const model = { kind: 'team', lead, advisor: null, members: [member], xp: null, stopped: null }
  await act(async () => {
    root.render(
      <TeamTabContent
        model={model as unknown as TeamPanelGameModel}
        look="plain"
        selectTab={selectTab}
        now={0}
        onOpenTasks={vi.fn()}
      />
    )
  })
  const card = container.querySelector('[data-team-card="member"]') as HTMLElement
  const button = (name: string) =>
    [...card.querySelectorAll('button')].find((one) => one.textContent === name)
  return { card, selectTab, button }
}

// Why (ORCA-1231): a permission prompt read "Waiting for your answer" and its button opened an empty Inbox.
describe('a member card that waits on the person', () => {
  it('names a permission prompt and opens the pane that holds it', async () => {
    const { card, selectTab, button } = await render(toadette({ kind: 'permission', tool: 'Bash' }))

    expect(card.textContent).toContain('Permission prompt: Bash')
    expect(card.textContent).not.toContain('Waiting for your answer')
    expect(button('Answer in Inbox')).toBeUndefined()

    await act(async () => button('Answer in its terminal')?.click())
    expect(openTeamSession).toHaveBeenCalledWith(
      expect.objectContaining({ paneKey: 'tab-1216:leaf' }),
      'ORCA-1216'
    )
    expect(selectTab).not.toHaveBeenCalled()
  })

  it('keeps the Inbox for a question the Inbox holds', async () => {
    const { card, selectTab, button } = await render(toadette({ kind: 'inbox' }))

    expect(card.textContent).toContain('Waiting for your answer')
    await act(async () => button('Answer in Inbox')?.click())
    expect(selectTab).toHaveBeenCalledWith('inbox')
    expect(button('Answer in its terminal')).toBeUndefined()
  })
})
