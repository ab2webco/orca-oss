import { describe, expect, it, vi } from 'vitest'
import { MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import { readHostLeadStates, readHostTeamLine } from './host-team-read'

const LEAD_STATE = {
  role: 'lead',
  lead: { handle: 'term_a' },
  agents: [
    { name: 'Merlín', state: 'waiting' },
    { name: 'Arquera', state: 'working' }
  ]
}

function clientWith(answers: Record<string, { ok: boolean; result?: unknown }>) {
  const sendRequest = vi.fn(async (method: string) => answers[method] ?? { ok: false })
  return { client: { sendRequest } as never, sendRequest }
}

const LEADS = {
  leads: [{ handle: 'term_a', paneKey: 'tab:a', worktreeId: 'wt-a', project: 'web', since: 'x' }]
}

describe('readHostTeamLine', () => {
  it('reads nothing when the host does not advertise the team capability', async () => {
    const { client, sendRequest } = clientWith({ 'game.leads': { ok: true, result: LEADS } })

    await expect(readHostTeamLine(client, [])).resolves.toBeNull()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('reads each live lead and adds up its team', async () => {
    const { client } = clientWith({
      'game.leads': { ok: true, result: LEADS },
      'game.state': { ok: true, result: LEAD_STATE }
    })

    await expect(
      readHostTeamLine(client, [MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY])
    ).resolves.toEqual({ members: 2, working: 1, needsYou: 1 })
  })

  it('shows no line when the leads cannot be read, instead of failing the card', async () => {
    const { client } = clientWith({ 'game.leads': { ok: false } })

    await expect(
      readHostTeamLine(client, [MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY])
    ).resolves.toBeNull()
  })
})

describe('readHostLeadStates', () => {
  it("returns each live lead's game.state, and nothing from a host without the team capability", async () => {
    const { client } = clientWith({
      'game.leads': { ok: true, result: LEADS },
      'game.state': { ok: true, result: LEAD_STATE }
    })

    await expect(
      readHostLeadStates(client, [MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY])
    ).resolves.toEqual([LEAD_STATE])
    await expect(readHostLeadStates(client, [])).resolves.toBeNull()
  })
})
