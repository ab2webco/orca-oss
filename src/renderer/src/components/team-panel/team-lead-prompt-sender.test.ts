import { describe, expect, it, vi } from 'vitest'
import { createLeadPromptSender } from './team-lead-prompt-sender'

function sender(start = 1000): {
  press: ReturnType<typeof createLeadPromptSender>
  advance: (ms: number) => void
} {
  let now = start
  return { press: createLeadPromptSender(() => now), advance: (ms) => (now += ms) }
}

describe('createLeadPromptSender', () => {
  it('sends a press', async () => {
    const { press } = sender()
    const send = vi.fn().mockResolvedValue(true)

    await expect(press('lead:wave', send)).resolves.toBe('sent')

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('takes a double press as one turn', async () => {
    const { press, advance } = sender()
    const send = vi.fn().mockResolvedValue(true)

    await press('lead:wave', send)
    advance(2999)

    await expect(press('lead:wave', send)).resolves.toBe('repeat')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('takes a press while the first is still on its way as the same turn', async () => {
    const { press } = sender()
    let finish: (sent: boolean) => void = () => undefined
    const send = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))

    const first = press('lead:wave', send)
    await expect(press('lead:wave', send)).resolves.toBe('repeat')
    finish(true)

    await expect(first).resolves.toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('lets the same press through again once the window passes', async () => {
    const { press, advance } = sender()
    const send = vi.fn().mockResolvedValue(true)

    await press('lead:wave', send)
    advance(3000)

    await expect(press('lead:wave', send)).resolves.toBe('sent')
  })

  it('keeps each action apart', async () => {
    const { press } = sender()
    const send = vi.fn().mockResolvedValue(true)

    await press('lead:wave', send)

    await expect(press('lead:status', send)).resolves.toBe('sent')
  })

  it('reads a refused write as failed, and lets the person try again at once', async () => {
    const { press } = sender()
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)

    await expect(press('lead:wave', send)).resolves.toBe('failed')
    await expect(press('lead:wave', send)).resolves.toBe('sent')
  })

  it('reads a thrown write as failed', async () => {
    const { press } = sender()
    const send = vi.fn().mockRejectedValue(new Error('terminal_not_writable'))

    await expect(press('lead:wave', send)).resolves.toBe('failed')
  })
})
