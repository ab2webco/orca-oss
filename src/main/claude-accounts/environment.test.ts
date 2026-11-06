import { describe, expect, it } from 'vitest'
import { applyClaudeEnvPatch, CLAUDE_MANAGED_LAUNCH_ENV_TO_DELETE } from './environment'

// Claude CLI 2.1.319 derives its Keychain item and credentials file dir from
// CLAUDE_SECURESTORAGE_CONFIG_DIR whenever it is set, even to "", ignoring CLAUDE_CONFIG_DIR.
const KEYCHAIN_SCOPE_ENV = 'CLAUDE_SECURESTORAGE_CONFIG_DIR'

describe('applyClaudeEnvPatch', () => {
  it('drops an inherited Keychain scope when launching on a managed vault', () => {
    for (const inherited of ['/Users/someone/.claude', '']) {
      const env = applyClaudeEnvPatch(
        { [KEYCHAIN_SCOPE_ENV]: inherited, PATH: '/usr/bin' },
        { CLAUDE_CONFIG_DIR: '/vaults/account-a' },
        { stripAuthEnv: true }
      )
      expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/vaults/account-a', PATH: '/usr/bin' })
    }
  })

  it('leaves the Keychain scope alone on the unmanaged login', () => {
    const env = applyClaudeEnvPatch({ [KEYCHAIN_SCOPE_ENV]: '' }, {}, { stripAuthEnv: false })
    expect(env).toEqual({ [KEYCHAIN_SCOPE_ENV]: '' })
  })
})

describe('CLAUDE_MANAGED_LAUNCH_ENV_TO_DELETE', () => {
  it('removes ambient auth and the Keychain scope from a managed PTY spawn', () => {
    expect(CLAUDE_MANAGED_LAUNCH_ENV_TO_DELETE).toEqual(
      expect.arrayContaining([
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'ANTHROPIC_CUSTOM_HEADERS',
        KEYCHAIN_SCOPE_ENV
      ])
    )
  })
})
