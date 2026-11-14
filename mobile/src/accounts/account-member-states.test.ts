import { describe, expect, it, vi } from 'vitest'
import { MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import { readAccountMemberStates } from './account-member-states'

const LEAD_STATE = { role: 'lead', agents: [{ displayName: 'Merlín' }] }

function clientAnswering(capabilities: string[] | null) {
  const sendRequest = vi.fn(async (method: string) => {
    switch (method) {
      case 'status.get':
        return capabilities ? { ok: true, result: { capabilities } } : { ok: false }
      case 'game.leads':
        return {
          ok: true,
          result: { leads: [{ handle: 'term_a', paneKey: 'tab:a', worktreeId: 'wt-a' }] }
        }
      case 'game.state':
        return { ok: true, result: LEAD_STATE }
      default:
        return { ok: false }
    }
  })
  return { client: { sendRequest } as never, sendRequest }
}

describe('readAccountMemberStates', () => {
  it("reads each lead's state from a host that advertises the team", async () => {
    const { client } = clientAnswering([MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY])

    await expect(readAccountMemberStates(client, 'host-1')).resolves.toEqual([LEAD_STATE])
  })

  it('reads nothing from an older host, or when its status cannot be read', async () => {
    const older = clientAnswering([])
    await expect(readAccountMemberStates(older.client, 'host-1')).resolves.toEqual([])
    expect(older.sendRequest).not.toHaveBeenCalledWith('game.leads')

    await expect(readAccountMemberStates(clientAnswering(null).client, 'host-2')).resolves.toEqual(
      []
    )
  })
})
