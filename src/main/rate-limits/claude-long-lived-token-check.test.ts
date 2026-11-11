import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import { checkClaudeLongLivedToken } from './claude-long-lived-token-check'

const FAKE_TOKEN = 'fixture-token-not-a-real-credential'
const NOW = 1_762_800_000_000

function respond(status: number) {
  return vi.fn(async () => ({ status }))
}

describe('checkClaudeLongLivedToken', () => {
  it('asks the free models list with the token as an OAuth bearer', async () => {
    const fetchImpl = respond(200)

    await checkClaudeLongLivedToken(FAKE_TOKEN, { fetchImpl, now: () => NOW })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect((init.headers as Record<string, string>)['anthropic-beta']).toBe('oauth-2025-04-20')
  })

  it('reads 200 as verified and 401 or 403 as rejected', async () => {
    expect(
      await checkClaudeLongLivedToken(FAKE_TOKEN, { fetchImpl: respond(200), now: () => NOW })
    ).toEqual({
      state: 'verified',
      checkedAt: NOW
    })
    for (const status of [401, 403]) {
      expect(
        (
          await checkClaudeLongLivedToken(FAKE_TOKEN, {
            fetchImpl: respond(status),
            now: () => NOW
          })
        ).state
      ).toBe('rejected')
    }
  })

  it('stays undecided on a throttle, a server error or no network, so a blip never reads as rejected', async () => {
    for (const status of [429, 500, 529]) {
      expect(
        (
          await checkClaudeLongLivedToken(FAKE_TOKEN, {
            fetchImpl: respond(status),
            now: () => NOW
          })
        ).state
      ).toBe('undecided')
    }
    const offline = vi.fn(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    expect(
      (await checkClaudeLongLivedToken(FAKE_TOKEN, { fetchImpl: offline, now: () => NOW })).state
    ).toBe('undecided')
  })
})
