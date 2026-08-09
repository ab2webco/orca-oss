import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { clickWithoutFrameDependency, disableCssAnimations } from './helpers/frame-independent-ui'

type FakeMicrophoneDevice = {
  deviceId: string
  label: string
}

type FakeMicrophoneState = {
  devices: FakeMicrophoneDevice[]
  dispatchDeviceChange: () => void
}

async function installFakeMicrophoneDevices(
  page: Parameters<typeof waitForSessionReady>[0],
  devices: FakeMicrophoneDevice[]
): Promise<void> {
  await page.addInitScript((initialDevices) => {
    const listeners = new Set<EventListener>()
    const state: FakeMicrophoneState = {
      devices: initialDevices,
      dispatchDeviceChange: () => {
        for (const listener of listeners) {
          listener(new Event('devicechange'))
        }
      }
    }
    const mediaDevices = {
      enumerateDevices: async () =>
        state.devices.map((device) => ({
          ...device,
          kind: 'audioinput' as const,
          groupId: ''
        })),
      getUserMedia: async () => {
        throw new DOMException('E2E microphone access is not used by this spec', 'NotAllowedError')
      },
      addEventListener: (type: string, listener: EventListener) => {
        if (type === 'devicechange') {
          listeners.add(listener)
        }
      },
      removeEventListener: (type: string, listener: EventListener) => {
        if (type === 'devicechange') {
          listeners.delete(listener)
        }
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices
    })
    ;(
      window as Window & { __orcaE2EFakeMicrophone?: FakeMicrophoneState }
    ).__orcaE2EFakeMicrophone = state
  }, devices)
}

async function prepareVoiceSettings(
  page: Parameters<typeof waitForSessionReady>[0],
  microphoneDeviceId: string | null,
  microphoneDeviceLabel: string | null
): Promise<void> {
  await page.evaluate(
    async ({ microphoneDeviceId, microphoneDeviceLabel }) => {
      const store = window.__store
      const settings = await window.api.settings.get()
      if (!store || !settings.voice) {
        throw new Error('Voice settings are not available')
      }
      await store.getState().updateSettings({
        uiLanguage: 'en',
        voice: {
          ...settings.voice,
          enabled: true,
          microphoneDeviceId,
          microphoneDeviceLabel
        }
      })
      store.getState().openSettingsTarget({ pane: 'voice', repoId: null })
      store.getState().openSettingsPage()
    },
    { microphoneDeviceId, microphoneDeviceLabel }
  )
  await expect(page.getByPlaceholder('Search settings')).toBeVisible()
  const featureTipDialog = page.getByRole('dialog', { name: 'Voice Dictation is here' })
  if (await featureTipDialog.isVisible().catch(() => false)) {
    await clickWithoutFrameDependency(page.getByRole('button', { name: 'Maybe Later' }), page)
  }
  await expect(page.getByRole('heading', { name: 'Voice', exact: true })).toBeVisible()
}

/**
 * Why not `getByRole('combobox')`: Radix marks everything outside an open
 * Select popup `aria-hidden`, so the role locator stops resolving the trigger
 * until the popup finishes its exit animation. That animation needs compositor
 * frames, which the never-shown E2E window does not reliably get — the trigger
 * then reads as "element(s) not found" for the whole assertion timeout while
 * the DOM holds the correct value. Match the attributes instead.
 */
function microphoneTrigger(page: Parameters<typeof waitForSessionReady>[0]) {
  return page.locator('[data-slot="select-trigger"][aria-label="Microphone"]')
}

/**
 * Escape, then wait for the popup to actually unmount.
 *
 * Why: the shadcn SelectContent has an exit animation, so Radix's Presence
 * waits for `animationend` before unmounting. That needs compositor frames.
 * Without this wait a stuck popup surfaces further down as a confusing
 * "option not visible" on the NEXT open, instead of naming what stalled.
 */
async function closeSelectPopup(page: Parameters<typeof waitForSessionReady>[0]): Promise<void> {
  await page.keyboard.press('Escape')
  // Why 2s, not the 10s default: with animations off the unmount is
  // synchronous, so a slow close means the frame dependency came back.
  await expect(page.getByRole('listbox'), 'select popup did not close').toHaveCount(0, {
    timeout: 2_000
  })
}

async function readMicrophoneSettings(
  page: Parameters<typeof waitForSessionReady>[0]
): Promise<{ deviceId: string | null; label: string | null }> {
  return page.evaluate(async () => {
    const voice = (await window.api.settings.get()).voice
    return {
      deviceId: voice?.microphoneDeviceId ?? null,
      label: voice?.microphoneDeviceLabel ?? null
    }
  })
}

test.describe('Voice microphone selection', () => {
  test('lists devices, persists a selected microphone, and restores it', async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await disableCssAnimations(orcaPage)
    await installFakeMicrophoneDevices(orcaPage, [
      { deviceId: 'built-in', label: 'Built-in Microphone' },
      { deviceId: 'usb-mic', label: 'USB Microphone' }
    ])
    await orcaPage.reload({ waitUntil: 'domcontentloaded' })
    await waitForSessionReady(orcaPage)
    await prepareVoiceSettings(orcaPage, null, null)

    const microphone = microphoneTrigger(orcaPage)
    await expect(microphone).toHaveText('System default')
    await clickWithoutFrameDependency(microphone, orcaPage)
    await expect(orcaPage.getByRole('option', { name: 'USB Microphone' })).toBeVisible()
    await clickWithoutFrameDependency(
      orcaPage.getByRole('option', { name: 'USB Microphone' }),
      orcaPage
    )

    await expect
      .poll(() => readMicrophoneSettings(orcaPage), {
        message: 'selected microphone did not persist'
      })
      .toEqual({ deviceId: 'usb-mic', label: 'USB Microphone' })
    await expect(microphone).toHaveText('USB Microphone')

    await orcaPage.reload({ waitUntil: 'domcontentloaded' })
    await waitForSessionReady(orcaPage)
    await prepareVoiceSettings(orcaPage, 'usb-mic', 'USB Microphone')
    await expect(microphoneTrigger(orcaPage)).toHaveText('USB Microphone')
  })

  test('marks an unplugged device unavailable and follows a relabeled device', async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    await disableCssAnimations(orcaPage)
    await installFakeMicrophoneDevices(orcaPage, [
      { deviceId: 'built-in', label: 'Built-in Microphone' }
    ])
    await orcaPage.reload({ waitUntil: 'domcontentloaded' })
    await waitForSessionReady(orcaPage)
    await prepareVoiceSettings(orcaPage, 'stale-airpods-id', 'AirPods')

    const microphone = microphoneTrigger(orcaPage)
    await clickWithoutFrameDependency(microphone, orcaPage)
    await expect(orcaPage.getByRole('option', { name: 'AirPods (unavailable)' })).toBeVisible()
    await closeSelectPopup(orcaPage)

    await orcaPage.evaluate(() => {
      const state = (window as Window & { __orcaE2EFakeMicrophone?: FakeMicrophoneState })
        .__orcaE2EFakeMicrophone
      if (!state) {
        throw new Error('Fake microphone state is not available')
      }
      state.devices = [
        { deviceId: 'built-in', label: 'Built-in Microphone' },
        { deviceId: 'fresh-airpods-id', label: 'AirPods' }
      ]
      state.dispatchDeviceChange()
    })

    await expect(microphone).toHaveText('AirPods')
    await clickWithoutFrameDependency(microphone, orcaPage)
    await expect(orcaPage.getByRole('option', { name: 'AirPods' })).toBeVisible()
    await expect(orcaPage.getByRole('option', { name: 'AirPods (unavailable)' })).toHaveCount(0)
    await closeSelectPopup(orcaPage)
    await expect(readMicrophoneSettings(orcaPage)).resolves.toEqual({
      deviceId: 'stale-airpods-id',
      label: 'AirPods'
    })
  })
})
