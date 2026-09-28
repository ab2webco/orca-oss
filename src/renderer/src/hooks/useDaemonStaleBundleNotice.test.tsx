// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { DaemonStaleBundleNoticeHost } from './DaemonStaleBundleNoticeHost'

type StaleBundleNoticeStatus =
  | { stale: false }
  | { stale: true; pid: number; startedAtMs: number | null; dismissed: boolean }

const staleBundleNotice = vi.hoisted(() =>
  vi.fn(async (): Promise<StaleBundleNoticeStatus> => ({ stale: false }))
)
const dismissStaleBundleNotice = vi.hoisted(() => vi.fn(async () => ({ success: true })))
const openSettingsPage = vi.hoisted(() => vi.fn())
const openSettingsTarget = vi.hoisted(() => vi.fn())
const setSettingsSearchQuery = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    dismiss: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en',
      hasResourceBundle: () => true
    }
  })
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      openSettingsPage,
      openSettingsTarget,
      setSettingsSearchQuery,
      settings: { uiLanguage: 'en' }
    })
}))

vi.mock('@/store/plugin-language-packs', () => ({
  usePluginLanguagePackStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ packs: [], loaded: true })
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

describe('useDaemonStaleBundleNotice', () => {
  beforeEach(() => {
    staleBundleNotice.mockReset()
    staleBundleNotice.mockResolvedValue({ stale: false })
    dismissStaleBundleNotice.mockReset()
    dismissStaleBundleNotice.mockResolvedValue({ success: true })
    openSettingsPage.mockReset()
    openSettingsTarget.mockReset()
    setSettingsSearchQuery.mockReset()
    vi.mocked(toast.warning).mockReset()
    vi.mocked(toast.dismiss).mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pty: {
          management: {
            staleBundleNotice,
            dismissStaleBundleNotice
          }
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('does not toast when the adopted daemon is not stale', async () => {
    render(<DaemonStaleBundleNoticeHost />)
    await waitFor(() => {
      expect(staleBundleNotice).toHaveBeenCalled()
    })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('toasts the restart remedy once when the daemon predates the current bundle', async () => {
    staleBundleNotice.mockResolvedValue({
      stale: true,
      pid: 4242,
      startedAtMs: 1_000,
      dismissed: false
    })
    render(<DaemonStaleBundleNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
    const call = vi.mocked(toast.warning).mock.calls[0]
    const title = String(call?.[0] ?? '')
    const options = call?.[1] as
      | {
          description?: string
          action?: { onClick?: () => void }
          cancel?: { onClick?: () => void }
        }
      | undefined
    expect(title).toMatch(/daemon restart/i)
    expect(String(options?.description ?? '')).toMatch(/Manage Sessions/i)

    options?.action?.onClick?.()
    expect(setSettingsSearchQuery).toHaveBeenCalledWith('')
    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'terminal',
      repoId: null,
      sectionId: 'terminal-manage-sessions'
    })
    expect(openSettingsPage).toHaveBeenCalled()

    options?.cancel?.onClick?.()
    expect(dismissStaleBundleNotice).toHaveBeenCalledWith({ pid: 4242, startedAtMs: 1_000 })
  })

  it('does not surface the notice when the backend reports it already dismissed for this daemon', async () => {
    staleBundleNotice.mockResolvedValue({
      stale: true,
      pid: 4242,
      startedAtMs: 1_000,
      dismissed: true
    })
    render(<DaemonStaleBundleNoticeHost />)
    await waitFor(() => {
      expect(staleBundleNotice).toHaveBeenCalled()
    })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('does not toast again on a later focus for the same daemon instance', async () => {
    staleBundleNotice.mockResolvedValue({
      stale: true,
      pid: 4242,
      startedAtMs: 1_000,
      dismissed: false
    })
    render(<DaemonStaleBundleNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(staleBundleNotice).toHaveBeenCalledTimes(2)
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
  })

  it('toasts again for a new daemon instance after a previous one was dismissed', async () => {
    staleBundleNotice.mockResolvedValueOnce({
      stale: true,
      pid: 4242,
      startedAtMs: 1_000,
      dismissed: false
    })
    render(<DaemonStaleBundleNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })

    staleBundleNotice.mockResolvedValue({
      stale: true,
      pid: 9999,
      startedAtMs: 2_000,
      dismissed: false
    })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(2)
    })
  })

  it('dismisses the toast once the daemon is no longer reported stale', async () => {
    staleBundleNotice.mockResolvedValueOnce({
      stale: true,
      pid: 4242,
      startedAtMs: 1_000,
      dismissed: false
    })
    render(<DaemonStaleBundleNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
    staleBundleNotice.mockResolvedValue({ stale: false })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(staleBundleNotice).toHaveBeenCalledTimes(2)
      expect(toast.dismiss).toHaveBeenCalledWith('daemon-stale-bundle-notice')
    })
  })
})
