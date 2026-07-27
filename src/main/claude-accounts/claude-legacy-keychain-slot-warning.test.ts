import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isClaudeLegacyKeychainBlobUnusable,
  noteLegacyClaudeKeychainSlotBlob,
  resetLegacyClaudeKeychainSlotWarningForTests
} from './claude-legacy-keychain-slot-warning'

const { showMessageBoxMock } = vi.hoisted(() => ({
  showMessageBoxMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getLocale: () => 'en' },
  dialog: { showMessageBox: showMessageBoxMock }
}))

const NOW = 1_700_000_000_000

function blob(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: 'test-access-value',
      refreshToken: '',
      expiresAt: NOW - 1000,
      ...overrides
    }
  })
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

describe('isClaudeLegacyKeychainBlobUnusable', () => {
  it('is true for an empty refresh token with an expired access token', () => {
    expect(isClaudeLegacyKeychainBlobUnusable(blob(), NOW)).toBe(true)
  })

  it('is true for a missing refresh token with no access token', () => {
    expect(
      isClaudeLegacyKeychainBlobUnusable(
        blob({ refreshToken: undefined, accessToken: undefined }),
        NOW
      )
    ).toBe(true)
  })

  it('is true for a whitespace refresh token with a blank access token', () => {
    expect(
      isClaudeLegacyKeychainBlobUnusable(blob({ refreshToken: '   ', accessToken: '' }), NOW)
    ).toBe(true)
  })

  it('is false when a real refresh token is present, even expired', () => {
    expect(isClaudeLegacyKeychainBlobUnusable(blob({ refreshToken: 'live-refresh' }), NOW)).toBe(
      false
    )
  })

  it('is false while the access token is still valid', () => {
    expect(isClaudeLegacyKeychainBlobUnusable(blob({ expiresAt: NOW + 60_000 }), NOW)).toBe(false)
  })

  it('is false when expiry is unknown but an access token exists', () => {
    expect(isClaudeLegacyKeychainBlobUnusable(blob({ expiresAt: undefined }), NOW)).toBe(false)
  })

  it('is false for non-credential contents', () => {
    expect(isClaudeLegacyKeychainBlobUnusable('not json', NOW)).toBe(false)
    expect(isClaudeLegacyKeychainBlobUnusable('{}', NOW)).toBe(false)
  })
})

describe('noteLegacyClaudeKeychainSlotBlob', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setPlatform('darwin')
    vi.clearAllMocks()
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    resetLegacyClaudeKeychainSlotWarningForTests()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('warns once across repeated polls of the same broken slot', async () => {
    noteLegacyClaudeKeychainSlotBlob(blob(), NOW)
    noteLegacyClaudeKeychainSlotBlob(blob(), NOW)
    noteLegacyClaudeKeychainSlotBlob(blob(), NOW)
    await vi.waitFor(() => expect(showMessageBoxMock).toHaveBeenCalledTimes(1))
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('never includes credential material in the diagnostic warning', async () => {
    noteLegacyClaudeKeychainSlotBlob(blob({ accessToken: 'super-secret-access' }), NOW)
    await vi.waitFor(() => expect(showMessageBoxMock).toHaveBeenCalledTimes(1))
    const logged = warnSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain('super-secret-access')
  })

  it('says managed accounts are unaffected and points at /login', async () => {
    noteLegacyClaudeKeychainSlotBlob(blob(), NOW)
    await vi.waitFor(() => expect(showMessageBoxMock).toHaveBeenCalledTimes(1))
    const options = showMessageBoxMock.mock.calls[0][0] as { message: string; detail: string }
    expect(options.detail).toContain('unaffected')
    expect(options.detail).toContain('/login')
  })

  it('stays quiet for a usable blob', async () => {
    noteLegacyClaudeKeychainSlotBlob(blob({ refreshToken: 'live-refresh' }), NOW)
    await new Promise((resolve) => setImmediate(resolve))
    expect(warnSpy).not.toHaveBeenCalled()
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('stays quiet off macOS', async () => {
    setPlatform('linux')
    noteLegacyClaudeKeychainSlotBlob(blob(), NOW)
    await new Promise((resolve) => setImmediate(resolve))
    expect(warnSpy).not.toHaveBeenCalled()
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('keeps the diagnostic warning when the dialog is unavailable', async () => {
    showMessageBoxMock.mockRejectedValue(new Error('headless'))
    noteLegacyClaudeKeychainSlotBlob(blob(), NOW)
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setImmediate(resolve))
  })
})
