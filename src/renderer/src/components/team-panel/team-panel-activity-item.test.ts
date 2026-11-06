import { User, Users } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { teamPanelActivityItem } from './team-panel-activity-item'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

describe('teamPanelActivityItem', () => {
  it('uses the group icon only for a game team', () => {
    expect(teamPanelActivityItem('team')).toMatchObject({
      id: 'team',
      icon: Users,
      title: 'Team'
    })
  })

  it('shows a single avatar when there is no team', () => {
    expect(teamPanelActivityItem('solo')).toMatchObject({
      id: 'team',
      icon: User,
      title: 'Your work'
    })
  })

  it('keeps the tab reachable before the model is known', () => {
    expect(teamPanelActivityItem(null)).toMatchObject({
      id: 'team',
      icon: Users,
      title: 'Team'
    })
  })
})
