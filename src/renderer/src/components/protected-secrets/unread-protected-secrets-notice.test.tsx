// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnreadProtectedSecret } from '../../../../shared/unread-protected-secret'
import {
  UNREAD_PROTECTED_SECRETS_TOAST_ID,
  useUnreadProtectedSecretsNotice
} from './unread-protected-secrets-notice'

const mocks = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  takeUnreadProtectedSecrets: vi.fn<() => Promise<UnreadProtectedSecret[]>>()
}))

vi.mock('sonner', () => ({ toast: { warning: mocks.toastWarning } }))

function NoticeHost(): null {
  useUnreadProtectedSecretsNotice()
  return null
}

let container: HTMLDivElement
let root: Root

async function mountNotice(): Promise<void> {
  await act(async () => {
    root.render(<NoticeHost />)
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.toastWarning.mockReset()
  mocks.takeUnreadProtectedSecrets.mockReset()
  vi.stubGlobal('api', {
    settings: { takeUnreadProtectedSecrets: mocks.takeUnreadProtectedSecrets }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('useUnreadProtectedSecretsNotice', () => {
  it('names every secret the keychain did not give up, in one sticky warning', async () => {
    mocks.takeUnreadProtectedSecrets.mockResolvedValue(['httpProxyUrl', 'sshSessionRecovery'])

    await mountNotice()

    expect(mocks.takeUnreadProtectedSecrets).toHaveBeenCalledTimes(1)
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1)
    const [title, options] = mocks.toastWarning.mock.calls[0]
    expect(title).toBe('Some saved secrets could not be read')
    expect(options).toMatchObject({ id: UNREAD_PROTECTED_SECRETS_TOAST_ID, duration: Infinity })
    expect(options.description).toContain('Network proxy URL, SSH session recovery')
  })

  it('shows nothing when every secret was read', async () => {
    mocks.takeUnreadProtectedSecrets.mockResolvedValue([])

    await mountNotice()

    expect(mocks.takeUnreadProtectedSecrets).toHaveBeenCalledTimes(1)
    expect(mocks.toastWarning).not.toHaveBeenCalled()
  })

  it('stays quiet when main cannot answer', async () => {
    mocks.takeUnreadProtectedSecrets.mockRejectedValue(new Error('No handler registered'))

    await mountNotice()

    expect(mocks.toastWarning).not.toHaveBeenCalled()
  })
})
