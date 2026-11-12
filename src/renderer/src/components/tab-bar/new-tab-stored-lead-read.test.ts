import { describe, expect, it, vi } from 'vitest'
import { readStoredTeamLead } from './new-tab-stored-lead-read'

const target = { kind: 'environment', environmentId: 'env-1' } as const

// Why (ORCA-717): clients and hosts update apart; an older host must never get a guessed Reopen.
describe('readStoredTeamLead', () => {
  it("returns the project's stored lead from a host that knows game.leadStored", async () => {
    const call = vi.fn(async () => ({ stored: { accountId: 'acct-glm' } }))

    await expect(readStoredTeamLead(target, 'wt-1', call)).resolves.toEqual({
      accountId: 'acct-glm'
    })
    expect(call).toHaveBeenCalledWith(target, 'game.leadStored', { worktreeId: 'wt-1' })
  })

  it('returns null when the host keeps no lead conversation', async () => {
    const call = vi.fn(async () => ({ stored: null }))

    await expect(readStoredTeamLead(target, 'wt-1', call)).resolves.toBeNull()
  })

  it('reads a host older than game.leadStored as unknown', async () => {
    const call = vi.fn(async () => {
      throw Object.assign(new Error('method_not_found'), { code: 'method_not_found' })
    })

    await expect(readStoredTeamLead(target, 'wt-1', call)).resolves.toBe('unknown')
  })

  it('reads an answer it cannot parse as unknown', async () => {
    const call = vi.fn(async () => ({ stored: { accountId: 42 } }))

    await expect(readStoredTeamLead(target, 'wt-1', call)).resolves.toBe('unknown')
  })
})
