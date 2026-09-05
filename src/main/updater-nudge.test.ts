import { beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetchMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock }
}))

import { fetchNudge, versionMatchesRange, shouldApplyNudge } from './updater-nudge'

describe('updater-nudge', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
  })

  describe('fetchNudge', () => {
    it('returns a valid config for a well-formed response', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'campaign-1', minVersion: '1.1.0', maxVersion: '1.1.19' })
      })

      const result = await fetchNudge()
      expect(result).toEqual({ id: 'campaign-1', minVersion: '1.1.0', maxVersion: '1.1.19' })
    })

    it('returns a valid config with only maxVersion', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'campaign-2', maxVersion: '1.1.19' })
      })

      const result = await fetchNudge()
      expect(result).toEqual({ id: 'campaign-2', maxVersion: '1.1.19' })
    })

    it('returns null for an empty response', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({})
      })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null for a null response', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => null
      })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null on non-ok HTTP response', async () => {
      netFetchMock.mockResolvedValue({ ok: false })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null on network error', async () => {
      netFetchMock.mockRejectedValue(new Error('network down'))

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('trims whitespace from the campaign id', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: '  campaign-1  ', minVersion: '1.0.0' })
      })

      const result = await fetchNudge()
      expect(result?.id).toBe('campaign-1')
    })

    it('returns null when id is missing', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ minVersion: '1.0.0' })
      })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when neither version endpoint is present', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'campaign-1' })
      })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when minVersion is invalid', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'campaign-1', minVersion: 'not-a-version' })
      })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when maxVersion is invalid', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'campaign-1', maxVersion: 'wat' })
      })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('returns null when the configured range is inverted', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'campaign-1',
          minVersion: '1.2.0',
          maxVersion: '1.1.0'
        })
      })

      await expect(fetchNudge()).resolves.toBeNull()
    })

    it('carries a well-formed content block through', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'campaign-1',
          maxVersion: '1.1.19',
          content: {
            version: '1.1.20',
            headline: 'Faster terminal start',
            highlights: ['Tabs restore in half the time', 'SSH panes keep their scrollback'],
            link: 'https://github.com/ab2webco/orca-oss/releases/tag/v1.1.20'
          }
        })
      })

      await expect(fetchNudge()).resolves.toEqual({
        id: 'campaign-1',
        maxVersion: '1.1.19',
        content: {
          version: '1.1.20',
          headline: 'Faster terminal start',
          highlights: ['Tabs restore in half the time', 'SSH panes keep their scrollback'],
          link: 'https://github.com/ab2webco/orca-oss/releases/tag/v1.1.20'
        }
      })
    })

    it('still fires a nudge that carries no content block', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'campaign-1', maxVersion: '1.1.19' })
      })

      const result = await fetchNudge()
      expect(result).not.toBeNull()
      expect(result?.content).toBeUndefined()
    })

    it.each([
      ['a string', 'Faster terminal start'],
      ['an array', ['Faster terminal start']],
      ['null', null],
      ['a missing version', { headline: 'Faster', highlights: ['One'] }],
      ['an invalid version', { version: 'latest', headline: 'Faster', highlights: ['One'] }],
      ['a missing headline', { version: '1.1.20', highlights: ['One'] }],
      ['a blank headline', { version: '1.1.20', headline: '   ', highlights: ['One'] }],
      ['non-array highlights', { version: '1.1.20', headline: 'Faster', highlights: 'One' }],
      ['a non-string highlight', { version: '1.1.20', headline: 'Faster', highlights: ['One', 2] }],
      ['a blank highlight', { version: '1.1.20', headline: 'Faster', highlights: ['One', ' '] }]
    ])('still fires the nudge when content is %s, dropping the content', async (_, content) => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'campaign-1', maxVersion: '1.1.19', content })
      })

      await expect(fetchNudge()).resolves.toEqual({ id: 'campaign-1', maxVersion: '1.1.19' })
    })

    it.each(['javascript:alert(1)', 'http://example.com/notes', 'release notes'])(
      'keeps the headline and drops a link that is not https (%s)',
      async (link) => {
        netFetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            id: 'campaign-1',
            maxVersion: '1.1.19',
            content: { version: '1.1.20', headline: 'Faster', highlights: [], link }
          })
        })

        await expect(fetchNudge()).resolves.toEqual({
          id: 'campaign-1',
          maxVersion: '1.1.19',
          content: { version: '1.1.20', headline: 'Faster', highlights: [] }
        })
      }
    )

    it('keeps only the first three distinct highlights and trims each line', async () => {
      netFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'campaign-1',
          maxVersion: '1.1.19',
          content: {
            version: ' 1.1.20 ',
            headline: '  Faster  ',
            highlights: [' One ', 'Two', 'One', 'Three', 'Four']
          }
        })
      })

      const result = await fetchNudge()
      expect(result?.content).toEqual({
        version: '1.1.20',
        headline: 'Faster',
        highlights: ['One', 'Two', 'Three']
      })
    })
  })

  describe('versionMatchesRange', () => {
    it('bounded range match', () => {
      expect(versionMatchesRange('1.1.5', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.1.0', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.1.19', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        true
      )
      expect(versionMatchesRange('1.0.9', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        false
      )
      expect(versionMatchesRange('1.2.0', { minVersion: '1.1.0', maxVersion: '1.1.19' })).toBe(
        false
      )
    })

    it('upper-only range match', () => {
      expect(versionMatchesRange('1.1.5', { maxVersion: '1.1.19' })).toBe(true)
      expect(versionMatchesRange('1.2.0', { maxVersion: '1.1.19' })).toBe(false)
    })

    it('lower-only range match', () => {
      expect(versionMatchesRange('1.1.5', { minVersion: '1.1.0' })).toBe(true)
      expect(versionMatchesRange('1.0.0', { minVersion: '1.1.0' })).toBe(false)
    })
  })

  describe('shouldApplyNudge', () => {
    const nudge = { id: 'campaign-1', minVersion: '1.0.0' }

    it('returns true when version matches and not dismissed/pending', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: null
        })
      ).toBe(true)
    })

    it('returns false when campaign already dismissed', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: 'campaign-1'
        })
      ).toBe(false)
    })

    it('returns false when campaign is already pending', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '1.5.0',
          pendingUpdateNudgeId: 'campaign-1',
          dismissedUpdateNudgeId: null
        })
      ).toBe(false)
    })

    it('returns false when version does not match', () => {
      expect(
        shouldApplyNudge({
          nudge,
          appVersion: '0.9.0',
          pendingUpdateNudgeId: null,
          dismissedUpdateNudgeId: null
        })
      ).toBe(false)
    })
  })
})
