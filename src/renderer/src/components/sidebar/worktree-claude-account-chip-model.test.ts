import { describe, expect, it } from 'vitest'
import type {
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../../../shared/types'
import {
  buildWorktreeClaudeAccountChipModel,
  getActiveClaudeAccountId
} from './worktree-claude-account-chip-model'

function account(
  overrides: Partial<ClaudeManagedAccountSummary> = {}
): ClaudeManagedAccountSummary {
  return {
    id: 'acct',
    email: 'user@example.com',
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...overrides
  }
}

function roster(
  overrides: Partial<ClaudeRateLimitAccountsState> = {}
): ClaudeRateLimitAccountsState {
  return {
    accounts: [
      account({ id: 'acct-active', email: 'active@example.com' }),
      account({ id: 'acct-pinned', email: 'pinned@example.com' })
    ],
    activeAccountId: 'acct-active',
    activeAccountIdsByRuntime: { host: null, wsl: {} },
    ...overrides
  }
}

const SYSTEM_DEFAULT = 'System default'

describe('buildWorktreeClaudeAccountChipModel', () => {
  it('shows the pinned account without an inherited marker', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: 'acct-pinned',
      wslDistro: null,
      roster: roster(),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model).toEqual({ label: 'pinned@example.com', inherited: false, isEndpoint: false })
  })

  it('inherits the global active account when there is no pin', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: null,
      wslDistro: null,
      roster: roster(),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model).toEqual({ label: 'active@example.com', inherited: true, isEndpoint: false })
  })

  it('prefers the per-runtime host selection over the flat active id', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: null,
      wslDistro: null,
      roster: roster({ activeAccountIdsByRuntime: { host: 'acct-pinned', wsl: {} } }),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model.label).toBe('pinned@example.com')
    expect(model.inherited).toBe(true)
  })

  it('shows the endpoint label for a pinned custom-endpoint account', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: 'acct-endpoint',
      wslDistro: null,
      roster: roster({
        accounts: [
          account({ id: 'acct-active', email: 'active@example.com' }),
          account({
            id: 'acct-endpoint',
            email: 'token@z.ai',
            authMethod: 'custom-endpoint',
            endpointLabel: 'z.ai · GLM',
            endpointBaseUrl: 'https://api.z.ai/api/anthropic'
          })
        ]
      }),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model).toEqual({ label: 'z.ai · GLM', inherited: false, isEndpoint: true })
  })

  it('falls back to the endpoint host when no endpoint label is set', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: 'acct-endpoint',
      wslDistro: null,
      roster: roster({
        accounts: [
          account({
            id: 'acct-endpoint',
            email: 'token@z.ai',
            authMethod: 'custom-endpoint',
            endpointBaseUrl: 'https://api.z.ai/api/anthropic'
          })
        ],
        activeAccountId: null
      }),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model.label).toBe('api.z.ai')
    expect(model.isEndpoint).toBe(true)
  })

  it('falls back to the global account for a dangling pin (removed account)', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: 'acct-removed',
      wslDistro: null,
      roster: roster(),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model).toEqual({ label: 'active@example.com', inherited: true, isEndpoint: false })
  })

  it('shows the system default when no managed account is globally active', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: null,
      wslDistro: null,
      roster: roster({ accounts: [], activeAccountId: null }),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model).toEqual({ label: SYSTEM_DEFAULT, inherited: true, isEndpoint: false })
  })

  it('resolves the WSL selection when the worktree path is on a distro', () => {
    const model = buildWorktreeClaudeAccountChipModel({
      pinnedAccountId: null,
      wslDistro: 'Ubuntu',
      roster: roster({
        accounts: [account({ id: 'acct-wsl', email: 'wsl@example.com' })],
        activeAccountId: 'acct-active',
        activeAccountIdsByRuntime: { host: null, wsl: { Ubuntu: 'acct-wsl' } }
      }),
      systemDefaultLabel: SYSTEM_DEFAULT
    })
    expect(model.label).toBe('wsl@example.com')
    expect(model.inherited).toBe(true)
  })
})

describe('getActiveClaudeAccountId', () => {
  it('uses the host selection then the flat active id for host targets', () => {
    expect(
      getActiveClaudeAccountId(
        {
          accounts: [],
          activeAccountId: 'flat',
          activeAccountIdsByRuntime: { host: null, wsl: {} }
        },
        null
      )
    ).toBe('flat')
    expect(
      getActiveClaudeAccountId(
        {
          accounts: [],
          activeAccountId: 'flat',
          activeAccountIdsByRuntime: { host: 'host-sel', wsl: {} }
        },
        null
      )
    ).toBe('host-sel')
  })

  it('reads the per-distro selection for WSL targets and ignores the host/flat ids', () => {
    expect(
      getActiveClaudeAccountId(
        {
          accounts: [],
          activeAccountId: 'flat',
          activeAccountIdsByRuntime: { host: 'host-sel', wsl: { Ubuntu: 'wsl-sel' } }
        },
        'Ubuntu'
      )
    ).toBe('wsl-sel')
    expect(
      getActiveClaudeAccountId(
        {
          accounts: [],
          activeAccountId: 'flat',
          activeAccountIdsByRuntime: { host: 'host-sel', wsl: {} }
        },
        'Ubuntu'
      )
    ).toBeNull()
  })
})
