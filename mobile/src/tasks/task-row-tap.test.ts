import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveTaskRowTap } from './task-row-tap'

const planeWithUrl = {
  provider: 'plane',
  source: { url: 'https://plane.example/orca/work-items/ORCA-360' }
} as const

describe('resolveTaskRowTap', () => {
  it('routes a Plane item with a url to the in-app detail, not the browser', () => {
    expect(resolveTaskRowTap(planeWithUrl)).toEqual({ kind: 'plane-detail', item: planeWithUrl })
  })

  it('routes a Plane item whose url is the schema default to the in-app detail', () => {
    const item = { provider: 'plane', source: { url: '' } } as const
    expect(resolveTaskRowTap(item)).toEqual({ kind: 'plane-detail', item })
  })

  it('opens a GitLab todo at its target url', () => {
    const item = { provider: 'gitlabTodo', source: { targetUrl: 'https://gitlab.example/mr/1' } }
    expect(resolveTaskRowTap(item)).toEqual({
      kind: 'open-external',
      url: 'https://gitlab.example/mr/1'
    })
  })

  it.each(['github', 'gitlab', 'linear'] as const)('sends %s to the action sheet', (provider) => {
    const item = { provider, source: { url: 'https://example.test/1' } }
    expect(resolveTaskRowTap(item)).toEqual({ kind: 'action-sheet', item })
  })
})

/** Wiring assertions on the route. The red/green discriminator for ORCA-360 is
 *  the first test: the old row `onPress` opened `item.source.url` directly. */
describe('tasks route row tap wiring', () => {
  const source = readFileSync(new URL('../../app/h/[hostId]/tasks.tsx', import.meta.url), 'utf8')

  // Why: `slice(start, -1)` trims one byte silently; a missing end marker would
  // let the assertions below pass vacuously.
  function block(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker)
    expect(start, `tasks.tsx must contain ${startMarker}`).toBeGreaterThan(-1)
    const end = source.indexOf(endMarker, start)
    expect(end, `${startMarker} must be followed by ${endMarker}`).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('resolves the row tap instead of opening the Plane url in place', () => {
    const rowPress = block(
      'const branchSummary = hostedBranchSummary(item)',
      '<View style={styles.taskIcon}>'
    )
    expect(rowPress).toContain('onPress={() => {')
    expect(rowPress).toContain('resolveTaskRowTap(')
    expect(rowPress).not.toContain('Linking.openURL(item.source.url)')
  })

  it('opens the one Plane detail from a row: the full sheet, not a read-only drawer', () => {
    const surface = block('<PlaneTasksSurface', '/>')
    expect(surface).toContain('detailItem={planeDetailItem?.source ?? null}')
    expect(surface).toContain('viewMode={planeViewMode}')
    // Copy link rode the removed read-only drawer; it must be wired through the surface now,
    // or Plane silently loses the action GitHub and Linear keep (ORCA-385 blocker).
    expect(surface).toContain('onCopyLink=')
    expect(surface).toContain('copyTaskLink(')
    expect(source).not.toContain('<PlaneWorkItemDetail')
    // ORCA-385: the board is a view of this screen, not a route behind a door.
    expect(source).not.toContain('use-open-mobile-plane-board')
  })
})
