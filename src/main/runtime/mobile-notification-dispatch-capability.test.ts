import { describe, expect, it, vi } from 'vitest'

const notificationShow = vi.hoisted(() => vi.fn())
const notificationCtor = vi.hoisted(() => vi.fn())
vi.mock('electron', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  Notification: Object.assign(
    function Notification(this: unknown, options: unknown) {
      notificationCtor(options)
      return { show: notificationShow }
    },
    { isSupported: () => true }
  )
}))

import { OrcaRuntimeService } from './orca-runtime'
import type { MobileNotificationEvent } from './orca-runtime'

const CAPABILITY = `dcap_${'D'.repeat(43)}`

describe('phone pushes never carry a dispatch capability', () => {
  it('redacts every push, whoever built it', () => {
    const runtime = new OrcaRuntimeService(null)
    const pushed: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((event) => pushed.push(event))

    runtime.dispatchMobileNotification({
      type: 'notification',
      source: 'game-owner-question',
      title: `orca-oss ${CAPABILITY}`,
      body: `Is --dispatch-capability ${CAPABILITY} valid?`
    })

    expect(pushed).toMatchObject([
      { title: 'orca-oss [redacted]', body: 'Is --dispatch-capability [redacted] valid?' }
    ])
  })

  it('redacts a plugin notice on the desktop and the phone', async () => {
    const runtime = new OrcaRuntimeService(null)
    const pushed: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((event) => pushed.push(event))

    await runtime.dispatchPluginNotification({
      pluginId: 'worklog',
      title: 'Copied',
      body: `--dispatch-capability=${CAPABILITY}`
    })

    expect(notificationCtor).toHaveBeenCalledWith({
      title: 'worklog: Copied',
      body: '--dispatch-capability=[redacted]'
    })
    expect(JSON.stringify(pushed)).not.toContain('dcap_')
  })
})
