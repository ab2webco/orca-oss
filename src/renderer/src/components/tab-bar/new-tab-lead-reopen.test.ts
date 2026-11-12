import { describe, expect, it, vi } from 'vitest'
import { reopenTeamLead } from './new-tab-lead-reopen'

const target = { kind: 'environment', environmentId: 'env-1' } as const
const CALL = { worktreeId: 'wt-1', project: 'orca-oss' }

// Why (ORCA-717): Reopen team asks the host to reopen the kept lead; the menu opens no pane itself.
describe('reopenTeamLead', () => {
  it('asks the host to reopen the kept lead and names the pane that leads now', async () => {
    const call = vi.fn(async () => ({ registered: false, resumed: { handle: 'term_r' } }))

    await expect(reopenTeamLead(target, CALL, call)).resolves.toEqual({
      kind: 'lead',
      handle: 'term_r'
    })
    expect(call).toHaveBeenCalledWith(target, 'game.leadReopen', {
      worktreeId: 'wt-1',
      project: 'orca-oss',
      label: ''
    })
  })

  it('names a lead that was already live', async () => {
    const call = vi.fn(async () => ({ registered: false, live: { handle: 'term_a' } }))

    await expect(reopenTeamLead(target, CALL, call)).resolves.toEqual({
      kind: 'lead',
      handle: 'term_a'
    })
  })

  it('says why when the conversation did not reopen', async () => {
    const call = vi.fn(async () => ({ registered: false, resumeError: 'No conversation found' }))

    await expect(reopenTeamLead(target, CALL, call)).resolves.toEqual({
      kind: 'failed',
      reason: 'No conversation found'
    })
  })

  it('reads a host older than game.leadReopen as unsupported', async () => {
    const call = vi.fn(async () => {
      throw Object.assign(new Error('method_not_found'), { code: 'method_not_found' })
    })

    await expect(reopenTeamLead(target, CALL, call)).resolves.toEqual({ kind: 'unsupported' })
  })

  it('reads an answer that names no lead as nothing kept', async () => {
    const call = vi.fn(async () => ({ registered: false }))

    await expect(reopenTeamLead(target, CALL, call)).resolves.toEqual({ kind: 'nothing-kept' })
  })
})
