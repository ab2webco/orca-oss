import { describe, expect, it } from 'vitest'
import { resolveAgentGridPage } from './agent-grid-paging'

const cells = [1, 2, 3, 4, 5, 6, 7]

describe('resolveAgentGridPage', () => {
  it('slices the requested page', () => {
    expect(resolveAgentGridPage(cells, 4, 0)).toEqual({
      visible: [1, 2, 3, 4],
      pageIndex: 0,
      pageCount: 2
    })
    expect(resolveAgentGridPage(cells, 4, 1).visible).toEqual([5, 6, 7])
  })

  it('clamps a page that no longer exists instead of rendering nothing', () => {
    // Agents can disappear while a later page is open.
    const page = resolveAgentGridPage([1, 2], 4, 3)
    expect(page.pageIndex).toBe(0)
    expect(page.visible).toEqual([1, 2])
  })

  it('reports one page when everything fits', () => {
    expect(resolveAgentGridPage(cells, 12, 0).pageCount).toBe(1)
  })

  it('treats a non-positive size as show-everything rather than dividing by zero', () => {
    expect(resolveAgentGridPage(cells, 0, 0).visible).toHaveLength(7)
  })
})
