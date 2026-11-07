import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  IssueStateBadge,
  LinearStateBadge,
  ReviewChecksBadge,
  ReviewStateBadge
} from './WorktreeCardMetadataStatusBadges'

const RAW_HUE = /(amber|emerald|rose|purple|green|red|yellow)-\d/

describe('metadata status badges', () => {
  it('paints issue state in the status tones', () => {
    expect(renderToStaticMarkup(<IssueStateBadge state="open" />)).toContain('text-status-info')
    expect(renderToStaticMarkup(<IssueStateBadge state="closed" />)).toContain(
      'text-status-success'
    )
  })

  it.each([
    ['Done', 'text-status-success'],
    ['Canceled', 'text-status-idle'],
    ['In Progress', 'text-status-info']
  ])('paints the Linear %s state as %s', (stateName, tone) => {
    const markup = renderToStaticMarkup(<LinearStateBadge stateName={stateName} />)
    expect(markup).toContain(tone)
    expect(markup).not.toMatch(RAW_HUE)
  })

  it.each([
    ['open', 'text-status-info'],
    ['merged', 'text-status-success'],
    ['closed', 'text-status-idle']
  ] as const)('paints a %s review as %s', (state, tone) => {
    const markup = renderToStaticMarkup(<ReviewStateBadge state={state} label="PR" />)
    expect(markup).toContain(tone)
    expect(markup).not.toMatch(RAW_HUE)
  })

  it.each([
    ['success', 'text-status-success'],
    ['failure', 'text-status-attention'],
    ['pending', 'text-status-info']
  ] as const)('paints %s checks as %s', (status, tone) => {
    const markup = renderToStaticMarkup(<ReviewChecksBadge status={status} />)
    expect(markup).toContain(tone)
    expect(markup).not.toMatch(RAW_HUE)
  })
})
