import { describe, expect, it } from 'vitest'
import { teamCardWordsOf } from './team-card-words'
import { teamLeadViewOf } from './team-drawer-model'
import { teamLeadLiveText } from './team-sheet-lead'

const leader = (over: Record<string, unknown> = {}) => ({
  paneKey: 'tab-1:leaf',
  displayName: 'Lead pane',
  agentType: 'claude',
  state: 'working',
  toolName: 'Read',
  toolInput: 'ACME-222',
  isLeader: true,
  isMember: false,
  launch: { model: 'Opus 5.5', effort: 'high' },
  ...over
})

const member = {
  paneKey: 'tab-2:leaf',
  displayName: 'Merlín',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true
}

const stateWith = (lead: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  role: 'lead',
  lead: { autostart: false, cap: 4, agent: 'claude' },
  leadName: 'Castillo',
  worktree: { id: 'repo::/lead', branch: 'main' },
  agents: [leader(lead), member],
  ...over
})

const en = teamCardWordsOf('en')

describe('the lead card on the Team sheet', () => {
  it("names the lead, its host and model, and words its step as the desktop's lead card", () => {
    const lead = teamLeadViewOf(stateWith())?.lead
    expect(lead?.name).toBe('Castillo')
    expect(lead?.host).toEqual({ kind: 'local' })
    expect(lead?.model).toEqual({ label: 'Opus 5.5', effort: 'high', source: 'launch' })
    expect(lead && teamLeadLiveText(lead, en)).toBe('Orchestrating · Read · ACME-222')
  })

  it('says the lead waits on the person while its question is open', () => {
    const lead = teamLeadViewOf(stateWith({ state: 'idle' }), new Set(), { ticket: 'ORCA-7' })?.lead
    expect(lead && teamLeadLiveText(lead, en)).toBe('Waiting for you · Question on ORCA-7')
    const plain = teamLeadViewOf(stateWith({ state: 'idle' }), new Set(), { ticket: null })?.lead
    expect(plain && teamLeadLiveText(plain, en)).toBe('Waiting for you')
  })

  it('words an idle or unreachable lead by its condition', () => {
    const idle = teamLeadViewOf(stateWith({ state: 'idle' }))?.lead
    expect(idle && teamLeadLiveText(idle, en)).toBe('Idle')
    const away = teamLeadViewOf(
      stateWith({ state: 'idle', remote: { host: 'm1', stateKnown: false } })
    )?.lead
    expect(away?.host).toMatchObject({ kind: 'remote', name: 'm1' })
    expect(away && teamLeadLiveText(away, en)).toBe('Host unreachable')
  })

  it('words a tool with no detail as the desktop does', () => {
    const lead = teamLeadViewOf(stateWith({ toolName: 'PushNotification', toolInput: null }))?.lead
    expect(lead && teamLeadLiveText(lead, en)).toBe('Orchestrating · Push notification')
  })

  it("words the lead in the host's language", () => {
    const es = teamCardWordsOf('es')
    const lead = teamLeadViewOf(stateWith())?.lead
    expect(lead && teamLeadLiveText(lead, es)).toBe('Orquestando · Read · ACME-222')
    const asking = teamLeadViewOf(stateWith({ state: 'idle' }), new Set(), {
      ticket: 'ORCA-7'
    })?.lead
    expect(asking && teamLeadLiveText(asking, es)).toBe('Te espera · Pregunta sobre ORCA-7')
  })

  it('has no lead card for a state with no lead agent, as an older host may send', () => {
    const view = teamLeadViewOf({ ...stateWith(), agents: [member] })
    expect(view?.members).toHaveLength(1)
    expect(view?.lead).toBeNull()
  })
})

describe('the advisor card on the Team sheet', () => {
  const line =
    'Approved Sonnet 5.5 · high for ACME-224: the change only touches its tests, so a smaller model is enough.'

  it("keeps Jev's whole sentence from the lead's game.state", () => {
    const view = teamLeadViewOf(
      stateWith({
        advisor: {
          model: 'Opus 5.5',
          effort: 'high',
          pinned: { model: false, effort: false },
          line
        }
      })
    )
    expect(view?.advisor?.line).toBe(line)
  })

  it('has no advisor card when the lead has no Jev, or the host is older', () => {
    expect(teamLeadViewOf(stateWith())?.advisor).toBeNull()
    expect(teamLeadViewOf(stateWith({ advisor: 'garbled' }))?.advisor).toBeNull()
  })
})
