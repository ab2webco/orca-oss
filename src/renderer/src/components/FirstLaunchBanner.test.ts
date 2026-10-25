// The banner states what the running build does: a build that cannot transmit never claims
// anonymous counts, and a transmitting build keeps its notice (ORCA-789).

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/telemetry', () => ({
  PRIVACY_URL: 'https://example.invalid/privacy',
  acknowledgeBanner: vi.fn<() => Promise<void>>(),
  setOptIn: vi.fn<(optedIn: boolean) => Promise<void>>()
}))

import { FirstLaunchBanner } from './FirstLaunchBanner'

function renderBanner(transmitsInBuild: boolean): string {
  return renderToStaticMarkup(
    React.createElement(FirstLaunchBanner, {
      transmitsInBuild,
      onResolve: () => {},
      fetchSettings: async () => {}
    })
  )
}

describe('FirstLaunchBanner copy follows the transport gate', () => {
  it('states that a non-transmitting build sends no telemetry', () => {
    const markup = renderBanner(false)
    expect(markup).toContain('This Orca Lab build sends no telemetry')
    expect(markup).toContain('do not send usage counts or any other telemetry')
    expect(markup).not.toContain('Anonymous counts')
    expect(markup).not.toContain('Help us decide what to build next')
  })

  it('keeps the usage-counts notice in a transmitting build', () => {
    const markup = renderBanner(true)
    expect(markup).toContain('Help us decide what to build next')
    expect(markup).toContain('Anonymous counts of which features you use')
    expect(markup).not.toContain('sends no telemetry')
  })

  it.each([true, false])('keeps the privacy link and both actions (transmits=%s)', (transmits) => {
    const markup = renderBanner(transmits)
    expect(markup).toContain('Privacy policy')
    expect(markup).toContain('Got it')
    expect(markup).toContain('Opt out')
  })
})
