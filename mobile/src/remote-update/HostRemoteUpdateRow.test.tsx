import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { HostRemoteUpdateRow } from './HostRemoteUpdateRow'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

const auth = vi.hoisted(() => ({
  result: { success: true } as { success: true } | { success: false; error: string },
  calls: 0
}))
vi.mock('expo-local-authentication', () => ({
  authenticateAsync: async () => {
    auth.calls += 1
    return auth.result
  }
}))

const gates = vi.hoisted(() => ({
  hostCapabilities: ['mobile.remote-update-install.v1'] as string[]
}))
vi.mock('../components/HostProtocolGate', () => ({
  useHostProtocolGates: () => gates
}))

const offeredSnapshot = {
  appVersion: '1.4.160',
  runtimeId: 'rt-1',
  support: { installMode: 'interactive', automatic: true, reason: 'available' },
  status: { state: 'available', version: '1.4.161', changelog: null },
  mobileInstallRequest: null
}

function ok(result: unknown): RpcResponse {
  return { id: 'x', ok: true, result, _meta: { runtimeId: 'rt-1' } } as RpcResponse
}

describe('HostRemoteUpdateRow', () => {
  let mounted: ReactTestRenderer[] = []
  const latest = () => mounted.at(-1)!
  let replies: Record<string, unknown>
  let sendRequest: ReturnType<typeof vi.fn>

  beforeEach(() => {
    gates.hostCapabilities = ['mobile.remote-update-install.v1']
    auth.result = { success: true }
    auth.calls = 0
    replies = { 'updater.getStatus': offeredSnapshot }
    sendRequest = vi.fn(async (method: string) => ok(replies[method]))
  })

  afterEach(() => {
    act(() => mounted.forEach((view) => view.unmount()))
    mounted = []
  })

  async function render(connState: ConnectionState = 'connected') {
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      mounted.push(create(createElement(HostRemoteUpdateRow, { client, connState })))
    })
  }

  function texts() {
    return latest()
      .root.findAllByType('Text')
      .map((node) => [node.props.children].flat().join(''))
  }

  function installButton() {
    return latest()
      .root.findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Install update 1.4.161 on this desktop')
  }

  async function pressInstall() {
    await act(async () => {
      await installButton()!.props.onPress()
    })
  }

  it('offers the desktop feed update with a 44pt button', async () => {
    await render()

    expect(sendRequest).toHaveBeenCalledWith('updater.getStatus')
    expect(texts()).toContain('Orca Lab 1.4.161 is ready (this desktop runs 1.4.160)')
    const style = [installButton()!.props.style({ pressed: false })].flat(3)
    expect(
      Math.max(...style.map((s: { minHeight?: number } | false) => (s ? (s.minHeight ?? 0) : 0)))
    ).toBeGreaterThanOrEqual(44)
  })

  it('asks for the phone owner before sending the request, with no version or URL', async () => {
    replies['updater.requestMobileInstall'] = {
      accepted: true,
      request: { requestId: 'r1', deviceName: 'Pixel', phase: 'countdown', deadlineAt: 5 }
    }
    await render()
    await pressInstall()

    expect(auth.calls).toBe(1)
    expect(sendRequest).toHaveBeenCalledWith('updater.requestMobileInstall', {})
    expect(texts().some((text) => /cancel it on the desktop/i.test(text))).toBe(true)
  })

  it('sends nothing when the owner cancels the prompt', async () => {
    auth.result = { success: false, error: 'user_cancel' }
    await render()
    await pressInstall()

    expect(sendRequest).not.toHaveBeenCalledWith('updater.requestMobileInstall', {})
  })

  it('refuses on a phone with no lock', async () => {
    auth.result = { success: false, error: 'passcode_not_set' }
    await render()
    await pressInstall()

    expect(sendRequest).not.toHaveBeenCalledWith('updater.requestMobileInstall', {})
    expect(texts().some((text) => /set a passcode/i.test(text))).toBe(true)
  })

  it('shows which agents the install would interrupt', async () => {
    replies['updater.requestMobileInstall'] = {
      accepted: false,
      reason: 'agents-working',
      agents: [{ paneKey: 'tab-1:0', agentType: 'claude' }]
    }
    await render()
    await pressInstall()

    expect(texts()).toContain('claude (tab-1:0)')
  })

  it('shows the active request instead of a second button', async () => {
    replies['updater.getStatus'] = {
      ...offeredSnapshot,
      status: { state: 'downloading', version: '1.4.161', percent: 20 },
      mobileInstallRequest: {
        requestId: 'r1',
        deviceName: 'Pixel',
        phase: 'downloading',
        deadlineAt: null
      }
    }
    await render()

    expect(installButton()).toBeUndefined()
    expect(texts().some((text) => /downloading the update/i.test(text))).toBe(true)
  })

  it('stays hidden on an older host or without an offer', async () => {
    gates.hostCapabilities = []
    await render()
    expect(latest().toJSON()).toBeNull()
    expect(sendRequest).not.toHaveBeenCalled()

    gates.hostCapabilities = ['mobile.remote-update-install.v1']
    replies['updater.getStatus'] = { ...offeredSnapshot, status: { state: 'not-available' } }
    await render()
    expect(latest().toJSON()).toBeNull()
  })

  it('does not read the status while disconnected', async () => {
    await render('disconnected')
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
