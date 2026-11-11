import { describe, expect, it } from 'vitest'
import {
  applyLongLivedTokenToVaultSettings,
  CLAUDE_LONG_LIVED_TOKEN_ENV,
  normalizeLongLivedToken,
  readLongLivedTokenFromVaultSettings,
  vaultSettingsHaveLongLivedToken
} from './claude-long-lived-token'

const FAKE_TOKEN = 'fixture-token-not-a-real-credential'

describe('normalizeLongLivedToken', () => {
  it('trims surrounding whitespace and a trailing newline from a paste', () => {
    expect(normalizeLongLivedToken(`  ${FAKE_TOKEN}\n`)).toBe(FAKE_TOKEN)
  })

  it('rejects an empty value, inner whitespace or control characters', () => {
    expect(() => normalizeLongLivedToken('  \n')).toThrow(/empty/)
    expect(() => normalizeLongLivedToken('two words')).toThrow(/whitespace/)
    expect(() => normalizeLongLivedToken('a\u0000b')).toThrow(/whitespace/)
  })

  it('rejects an oversized value without echoing it', () => {
    const huge = 'x'.repeat(5_000)
    let message = ''
    try {
      normalizeLongLivedToken(huge)
    } catch (error) {
      message = String(error)
    }
    expect(message).toMatch(/too long/)
    expect(message).not.toContain('xxxx')
  })
})

describe('applyLongLivedTokenToVaultSettings', () => {
  it('adds the token to env and keeps every other key', () => {
    const current = JSON.stringify({ theme: 'dark', env: { FOO: '1' }, hooks: { Stop: [] } })
    const next = JSON.parse(applyLongLivedTokenToVaultSettings(current, FAKE_TOKEN))
    expect(next).toEqual({
      theme: 'dark',
      env: { FOO: '1', [CLAUDE_LONG_LIVED_TOKEN_ENV]: FAKE_TOKEN },
      hooks: { Stop: [] }
    })
  })

  it('creates settings from nothing', () => {
    const next = JSON.parse(applyLongLivedTokenToVaultSettings(null, FAKE_TOKEN))
    expect(next).toEqual({ env: { [CLAUDE_LONG_LIVED_TOKEN_ENV]: FAKE_TOKEN } })
  })

  it('clears the token and drops an env left empty', () => {
    const current = JSON.stringify({
      theme: 'dark',
      env: { [CLAUDE_LONG_LIVED_TOKEN_ENV]: FAKE_TOKEN }
    })
    expect(JSON.parse(applyLongLivedTokenToVaultSettings(current, null))).toEqual({
      theme: 'dark'
    })
  })

  it('refuses to overwrite a settings file it cannot parse', () => {
    expect(() => applyLongLivedTokenToVaultSettings('{not json', FAKE_TOKEN)).toThrow(
      /settings\.json/
    )
    expect(() => applyLongLivedTokenToVaultSettings('[]', FAKE_TOKEN)).toThrow(/settings\.json/)
  })
})

describe('vaultSettingsHaveLongLivedToken', () => {
  it('is true only for a non-empty string token', () => {
    expect(
      vaultSettingsHaveLongLivedToken(
        JSON.stringify({ env: { [CLAUDE_LONG_LIVED_TOKEN_ENV]: FAKE_TOKEN } })
      )
    ).toBe(true)
    expect(
      vaultSettingsHaveLongLivedToken(
        JSON.stringify({ env: { [CLAUDE_LONG_LIVED_TOKEN_ENV]: '' } })
      )
    ).toBe(false)
    expect(vaultSettingsHaveLongLivedToken('{bad')).toBe(false)
    expect(vaultSettingsHaveLongLivedToken(null)).toBe(false)
  })
})

describe('readLongLivedTokenFromVaultSettings', () => {
  it('returns the stored token, or null when there is none to check', () => {
    expect(
      readLongLivedTokenFromVaultSettings(
        JSON.stringify({ env: { [CLAUDE_LONG_LIVED_TOKEN_ENV]: ` ${FAKE_TOKEN} ` } })
      )
    ).toBe(FAKE_TOKEN)
    expect(
      readLongLivedTokenFromVaultSettings(
        JSON.stringify({ env: { [CLAUDE_LONG_LIVED_TOKEN_ENV]: '' } })
      )
    ).toBeNull()
    expect(readLongLivedTokenFromVaultSettings('{bad')).toBeNull()
    expect(readLongLivedTokenFromVaultSettings(null)).toBeNull()
  })
})
