// @vitest-environment happy-dom

import { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let language: 'en' | 'es' = 'en'
const listeners = new Set<() => void>()
const setLanguage = (next: 'en' | 'es'): void => {
  language = next
  listeners.forEach((listener) => listener())
}
vi.mock('react-i18next', () => ({
  useTranslation: () =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => language
    )
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => (language === 'es' ? 'Te espera' : fallback)
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ rightSidebarOpen: true, rightSidebarTab: 'team' })
}))
const asker = {
  name: 'ORCA-14',
  host: { kind: 'local' },
  status: 'attention',
  model: null,
  ticket: { identifier: 'ORCA-14', title: null, url: null, statusGroup: null },
  pr: null,
  needsYou: true
} as unknown as TeamMemberCard
vi.mock('./use-team-panel-model', () => ({ useTeamMemberOfTab: () => asker }))

const { TeamMemberPaneHeader } = await import('./TeamMemberPaneHeader')

// Why: the model only changes on the next 20 s poll, so the header must follow the language itself.
it('follows the UI language without waiting for the next model read', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<TeamMemberPaneHeader tabId="tab-14" />))
  expect(container.textContent).toContain('Waiting for you')

  await act(async () => setLanguage('es'))

  expect(container.textContent).toContain('Te espera')
  await act(async () => root.unmount())
})
