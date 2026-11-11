// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CircleAlert } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_GROUP_META } from '../grouping/group-keys'
import { SectionHeaderGlyph } from './section-header-glyph'

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(node: React.JSX.Element): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(node))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('SectionHeaderGlyph draws V30 tree glyphs (ORCA-1149)', () => {
  it("draws a project with V30's repo glyph, not its avatar", () => {
    const html = render(
      <SectionHeaderGlyph
        icon={PROJECT_GROUP_META.icon}
        tone="text-foreground"
        isProject
        isProjectGroup={false}
      />
    )

    expect(html.querySelector('[data-sidebar-tree-glyph="repo"]')).not.toBeNull()
    expect(html.querySelector('img')).toBeNull()
  })

  it("draws an org (project group) with V30's group glyph", () => {
    const html = render(
      <SectionHeaderGlyph
        icon={PROJECT_GROUP_META.icon}
        tone="text-foreground"
        isProject={false}
        isProjectGroup
      />
    )

    expect(html.querySelector('[data-sidebar-tree-glyph="group"]')).not.toBeNull()
  })

  it('keeps the status icon of a status group', () => {
    const html = render(
      <SectionHeaderGlyph
        icon={CircleAlert}
        tone="text-status-warning"
        isProject={false}
        isProjectGroup={false}
      />
    )

    expect(html.querySelector('[data-sidebar-tree-glyph]')).toBeNull()
    expect(html.querySelector('svg')).not.toBeNull()
  })
})
