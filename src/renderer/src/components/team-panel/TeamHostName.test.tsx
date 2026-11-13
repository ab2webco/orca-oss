// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n/i18n'

const store = vi.hoisted(() => ({
  settings: { hostSettingOverrides: {} as Record<string, { displayLabel?: string }> }
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof store) => unknown) => selector(store)
}))

const { TeamHostName } = await import('./TeamHostName')

let root: Root | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
    await i18n.changeLanguage('en')
  })
  root = null
  store.settings.hostSettingOverrides = {}
})

async function render(element: React.JSX.Element): Promise<HTMLElement> {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => {
    root?.render(element)
  })
  return container
}

// Why (ORCA-1149): the Team panel named the local machine 'local' and ignored a rename.
describe('TeamHostName', () => {
  it('names the local machine This computer', async () => {
    expect((await render(<TeamHostName host={{ kind: 'local' }} />)).textContent).toBe(
      'This computer'
    )
  })

  it('shows the name the user gave the local machine', async () => {
    store.settings.hostSettingOverrides = { local: { displayLabel: 'Studio' } }
    expect((await render(<TeamHostName host={{ kind: 'local' }} />)).textContent).toBe('Studio')
  })

  it('relabels on a live switch to Spanish', async () => {
    const container = await render(<TeamHostName host={{ kind: 'local' }} />)
    await act(async () => {
      await i18n.changeLanguage('es')
    })
    expect(container.textContent).toBe('Este equipo')
  })

  it('names a remote machine by its host', async () => {
    const host = { kind: 'remote', name: 'imac', environmentId: 'env', reachable: true } as const
    expect((await render(<TeamHostName host={host} />)).textContent).toBe('imac')
  })
})
