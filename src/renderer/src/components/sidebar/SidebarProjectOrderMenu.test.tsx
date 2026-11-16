// @vitest-environment happy-dom
// ORCA-1216 §5: the sort button marks an order that is not the default with a dot.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectOrderBy } from '../../../../shared/ui-chrome-types'

const mocks = vi.hoisted(() => ({ projectOrderBy: 'needs-you' as ProjectOrderBy }))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ projectOrderBy: mocks.projectOrderBy, setProjectOrderBy: vi.fn() })
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

import { i18n } from '../../i18n/i18n'
import SidebarProjectOrderMenu from './SidebarProjectOrderMenu'

function trigger(): string {
  return renderToStaticMarkup(<SidebarProjectOrderMenu onMenuOpenChange={vi.fn()} />)
}

describe('SidebarProjectOrderMenu trigger', () => {
  afterEach(async () => {
    mocks.projectOrderBy = 'needs-you'
    await i18n.changeLanguage('en')
  })

  it('shows no dot on the default order', () => {
    expect(trigger()).not.toContain('data-project-order-dot')
    expect(trigger()).toContain('data-project-order-trigger="needs-you"')
  })

  it.each(['recent', 'name', 'manual'] as const)('shows a dot on %s', (order) => {
    mocks.projectOrderBy = order
    expect(trigger()).toContain('data-project-order-dot')
  })

  it('names the button in the UI language', async () => {
    expect(trigger()).toContain('aria-label="Order projects"')
    await i18n.changeLanguage('es')
    expect(trigger()).toContain('aria-label="Ordenar proyectos"')
  })
})
