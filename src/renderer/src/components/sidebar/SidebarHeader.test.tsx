// ORCA-1131: the Spanish sidebar still titled its list "Projects".
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ groupBy: 'repo' }))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openModal: vi.fn(), groupBy: mocks.groupBy, repos: [{ id: 'r1' }] })
}))
vi.mock('@/hooks/useShortcutLabel', () => ({ useShortcutLabel: () => '' }))
vi.mock('./SidebarWorkspaceOptionsMenu', () => ({ default: () => null }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

import { i18n } from '../../i18n/i18n'
import SidebarHeader from './SidebarHeader'

function sectionTitle(): string | undefined {
  const markup = renderToStaticMarkup(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
  return /data-sidebar-section-title="[^"]+">([^<]+)</.exec(markup)?.[1]
}

describe('SidebarHeader section title', () => {
  afterEach(async () => {
    mocks.groupBy = 'repo'
    await i18n.changeLanguage('en')
  })

  it('names the list in the UI language', async () => {
    await i18n.changeLanguage('es')
    expect(sectionTitle()).toBe('Proyectos')
    mocks.groupBy = 'none'
    expect(sectionTitle()).toBe('Espacios de trabajo')
  })

  it('keeps English titles in English', () => {
    expect(sectionTitle()).toBe('Projects')
    mocks.groupBy = 'none'
    expect(sectionTitle()).toBe('Workspaces')
  })
})
