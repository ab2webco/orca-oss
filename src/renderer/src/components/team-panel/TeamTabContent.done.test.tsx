// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamLeadCard,
  TeamMemberCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'
import { TeamTabContent } from './TeamTabContent'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

const lead = (over: Partial<TeamLeadCard> = {}) =>
  ({
    paneKey: 'tab-lead:leaf',
    terminalHandle: 'term-lead',
    worktreeId: 'wt-main',
    host: { kind: 'local' },
    name: 'Alfred',
    status: 'idle',
    condition: 'idle',
    since: null,
    liveAction: null,
    model: null,
    ownerAsk: null,
    ...over
  }) as unknown as TeamLeadCard

const rosalina = (ci: 'failure' | 'pending' | 'success', over: Partial<TeamMemberCard> = {}) =>
  ({
    paneKey: 'tab-1198:leaf',
    terminalHandle: 'term-1198',
    worktreeId: 'wt-1198',
    host: { kind: 'local' },
    name: 'Rosalina',
    status: ci === 'failure' ? 'failed' : 'idle',
    condition: ci === 'success' ? 'done' : 'idle',
    since: null,
    liveAction: null,
    model: null,
    ticket: { identifier: 'ORCA-1198', title: null, url: null, statusGroup: null },
    pr: {
      provider: 'github',
      number: 1205,
      title: 't',
      url: 'u',
      state: 'open',
      ci,
      verdict: null,
      perfectMerge: null
    },
    needsYou: false,
    ask: null,
    ...over
  }) as unknown as TeamMemberCard

async function render(leadCard: TeamLeadCard, members: TeamMemberCard[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const model = { kind: 'team', lead: leadCard, advisor: null, members, xp: null, stopped: null }
  await act(async () => {
    root.render(
      <TeamTabContent
        model={model as unknown as TeamPanelGameModel}
        look="plain"
        selectTab={vi.fn()}
        now={0}
        onOpenTasks={vi.fn()}
      />
    )
  })
  return {
    member: container.querySelector('[data-team-card="member"]') as HTMLElement,
    leadCard: container.querySelector('[data-team-card="lead"]') as HTMLElement
  }
}

// Why (ORCA-1205): a red-CI member and a lead still waiting on members both read "Done".
describe('what a stopped card says', () => {
  it('says CI is failing, in the red tone, for a member stopped on a red PR', async () => {
    const { member } = await render(lead(), [rosalina('failure')])
    expect(member.textContent).toContain('CI failing')
    expect(member.textContent).not.toContain('Done')
    const line = [...member.querySelectorAll('span')].findLast(
      (one) => one.textContent === 'CI failing'
    )
    expect(line?.className).toContain('text-status-attention')
  })

  it('says CI is running for a member stopped on a pending PR', async () => {
    const { member } = await render(lead(), [rosalina('pending')])
    expect(member.textContent).toContain('CI running')
  })

  it('keeps Done for a member stopped on green CI', async () => {
    const { member } = await render(lead(), [rosalina('success')])
    expect(member.textContent).toContain('Done')
  })

  it('says the lead waits on its members instead of Done', async () => {
    const { leadCard } = await render(lead({ waitingOn: 3 }), [rosalina('failure')])
    expect(leadCard.textContent).toContain('Waiting on 3 agents')
    expect(leadCard.textContent).not.toContain('Done')
  })

  it('says it for one member too', async () => {
    const { leadCard } = await render(lead({ waitingOn: 1 }), [rosalina('failure')])
    expect(leadCard.textContent).toContain('Waiting on 1 agent')
  })
})
