// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const store = vi.hoisted(() => ({
  settings: { hostSettingOverrides: {} as Record<string, { displayLabel?: string }> }
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof store) => unknown) => selector(store)
}))

const { TeamHostTag } = await import('./TeamHostTag')

// Why stubbed: happy-dom lays nothing out, so the tag's room and the name's width are set here.
const room = { tag: 200, name: 80 }
const widths = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
}
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-team-host') ? room.tag : 0
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-team-host-name') ? room.name : 0
    }
  })
})
afterAll(() => {
  for (const [key, descriptor] of Object.entries(widths)) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, key, descriptor)
    }
  }
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  room.tag = 200
  room.name = 80
  store.settings.hostSettingOverrides = {}
})

async function render(host: Parameters<typeof TeamHostTag>[0]['host']): Promise<HTMLElement> {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <TeamHostTag host={host} />
      </TooltipProvider>
    )
  })
  return container.querySelector<HTMLElement>('[data-team-host]')!
}

const remote = { kind: 'remote', name: 'imac', environmentId: 'env', reachable: true } as const

// Why (ORCA-1149): at 390 and 320 the tag read 'Este…', a cut word that names nothing.
describe('TeamHostTag', () => {
  it('writes the whole name when it fits', async () => {
    const tag = await render({ kind: 'local' })
    expect(tag.textContent).toBe('This computer')
    expect(tag.querySelector('[data-team-host-icon]')).toBeNull()
  })

  it('draws a monitor named This computer instead of cutting the name', async () => {
    room.tag = 40
    const tag = await render({ kind: 'local' })
    const icon = tag.querySelector('[data-team-host-icon]')!
    expect(icon.getAttribute('data-team-host-icon')).toBe('local')
    expect(icon.getAttribute('aria-label')).toBe('This computer')
    expect(tag.querySelector('[data-team-host-name]')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws a server for a paired host that does not fit', async () => {
    room.tag = 20
    const icon = (await render(remote)).querySelector('[data-team-host-icon]')!
    expect(icon.getAttribute('data-team-host-icon')).toBe('remote')
    expect(icon.getAttribute('aria-label')).toBe('imac')
  })

  it("names the icon after the user's rename when the rename does not fit", async () => {
    store.settings.hostSettingOverrides = { local: { displayLabel: 'Studio upstairs' } }
    room.tag = 40
    const icon = (await render({ kind: 'local' })).querySelector('[data-team-host-icon]')!
    expect(icon.getAttribute('aria-label')).toBe('Studio upstairs')
  })
})
