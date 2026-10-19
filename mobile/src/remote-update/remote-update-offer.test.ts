import { describe, expect, it } from 'vitest'
import {
  MOBILE_REMOTE_UPDATE_INSTALL_CAPABILITY,
  describeMobileInstallResult,
  isRemoteUpdateInstallSupportedByHost,
  parseMobileInstallResult,
  parseRemoteUpdateOffer
} from './remote-update-offer'

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    appVersion: '1.4.160',
    runtimeId: 'rt-1',
    support: { installMode: 'interactive', automatic: true, reason: 'available' },
    status: { state: 'available', version: '1.4.161', changelog: null },
    mobileInstallRequest: null,
    ...overrides
  }
}

describe('isRemoteUpdateInstallSupportedByHost', () => {
  it('mirrors the host capability string', () => {
    expect(MOBILE_REMOTE_UPDATE_INSTALL_CAPABILITY).toBe('mobile.remote-update-install.v1')
    expect(isRemoteUpdateInstallSupportedByHost(['mobile.remote-update-install.v1'])).toBe(true)
    expect(isRemoteUpdateInstallSupportedByHost(['mobile.plugin-panels.v1'])).toBe(false)
  })
})

describe('parseRemoteUpdateOffer', () => {
  it('offers the version the desktop feed already offers', () => {
    expect(parseRemoteUpdateOffer(snapshot())).toEqual({
      currentVersion: '1.4.160',
      version: '1.4.161',
      canRequest: true,
      request: null
    })
  })

  it('offers a downloaded update too', () => {
    expect(
      parseRemoteUpdateOffer(snapshot({ status: { state: 'downloaded', version: '1.4.161' } }))
        ?.canRequest
    ).toBe(true)
  })

  it('shows an active request instead of a second button', () => {
    const offer = parseRemoteUpdateOffer(
      snapshot({
        status: { state: 'downloading', version: '1.4.161', percent: 40 },
        mobileInstallRequest: {
          requestId: 'r1',
          deviceName: 'Pixel',
          phase: 'downloading',
          deadlineAt: null
        }
      })
    )
    expect(offer).toMatchObject({ canRequest: false, request: { phase: 'downloading' } })
  })

  it('keeps parsing an older snapshot without mobileInstallRequest', () => {
    const { mobileInstallRequest: _omitted, ...older } = snapshot()
    expect(parseRemoteUpdateOffer(older)?.request).toBeNull()
  })

  it.each([
    ['no update', { status: { state: 'not-available' } }],
    ['a plain download', { status: { state: 'downloading', version: '1.4.161', percent: 3 } }],
    [
      'a headless serve',
      {
        support: { installMode: 'supervised-headless-serve', automatic: true, reason: 'available' }
      }
    ],
    [
      'a manual install',
      {
        support: {
          installMode: 'interactive',
          automatic: false,
          reason: 'manual-service-update-required'
        }
      }
    ]
  ])('offers nothing for %s', (_label, overrides) => {
    expect(parseRemoteUpdateOffer(snapshot(overrides))).toBeNull()
  })

  it('returns null for a malformed snapshot', () => {
    expect(parseRemoteUpdateOffer({ status: 'available' })).toBeNull()
    expect(parseRemoteUpdateOffer(null)).toBeNull()
  })
})

describe('parseMobileInstallResult', () => {
  it('parses an accepted request and every denial', () => {
    const request = { requestId: 'r1', deviceName: 'Pixel', phase: 'countdown', deadlineAt: 99 }
    expect(parseMobileInstallResult({ accepted: true, request })).toEqual({
      accepted: true,
      request
    })
    expect(
      parseMobileInstallResult({
        accepted: false,
        reason: 'agents-working',
        agents: [{ paneKey: 'tab-1:0', agentType: 'claude' }, { paneKey: 'tab-2:1' }]
      })
    ).toEqual({
      accepted: false,
      reason: 'agents-working',
      agents: [{ paneKey: 'tab-1:0', agentType: 'claude' }, { paneKey: 'tab-2:1' }]
    })
  })

  it('rejects a version or URL smuggled into the reply shape', () => {
    expect(parseMobileInstallResult({ accepted: false, reason: 'rate-limited', agents: [] })).toBe(
      null
    )
    expect(parseMobileInstallResult('ok')).toBeNull()
  })
})

describe('describeMobileInstallResult', () => {
  it('lists what the install would interrupt', () => {
    expect(
      describeMobileInstallResult({
        accepted: false,
        reason: 'agents-working',
        agents: [{ paneKey: 'tab-1:0', agentType: 'claude' }, { paneKey: 'tab-2:1' }]
      })
    ).toEqual({
      tone: 'warning',
      message:
        'Agents are working on this desktop, so it did not restart. Installing would interrupt:',
      interrupted: ['claude (tab-1:0)', 'Agent (tab-2:1)']
    })
  })

  it('points a disabled desktop to its setting', () => {
    expect(
      describeMobileInstallResult({ accepted: false, reason: 'disabled', agents: [] }).message
    ).toMatch(/Settings > General > Updates/)
  })

  it('says there is nothing to install', () => {
    expect(
      describeMobileInstallResult({ accepted: false, reason: 'not-available', agents: [] }).message
    ).toMatch(/no update/i)
  })

  it('tells the phone the countdown and Cancel are on the desktop', () => {
    const accepted = describeMobileInstallResult({
      accepted: true,
      request: { requestId: 'r1', deviceName: 'Pixel', phase: 'countdown', deadlineAt: 1 }
    })
    expect(accepted.tone).toBe('info')
    expect(accepted.message).toMatch(/cancel it on the desktop/i)
    expect(accepted.interrupted).toEqual([])
  })
})
