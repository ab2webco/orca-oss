import { describe, expect, it } from 'vitest'

import type { GameState } from '../types'
import { paneLinksOf } from '../hooks/pane-links'

const STATE: GameState = {
  config: {},
  warnings: [],
  worktree: null,
  agents: [],
  review: {
    provider: 'gitlab',
    number: 7,
    title: 'feat',
    url: 'https://gitlab.example/g/p/-/merge_requests/7',
    state: 'open',
    ci: 'pending'
  },
  workItem: {
    provider: 'linear',
    identifier: 'ENG-1',
    title: 'Thing',
    url: '',
    status: 'Todo',
    statusGroup: 'todo'
  },
  extensions: { scenes: [] },
  links: [],
  activity: null
}

describe('paneLinksOf', () => {
  it('opens the review of a host that sends no links, and skips a work item with no URL', () => {
    expect(paneLinksOf(STATE)).toEqual([
      {
        key: 'open-review',
        hotkey: 'o',
        label: '!7',
        url: 'https://gitlab.example/g/p/-/merge_requests/7'
      }
    ])
  })

  it("prefers the calling pane's own activity, else the first one Orca linked", () => {
    const activity = { name: 'Tambora', id: 'TR-1', url: 'https://t.example/TR-1', at: 1 }
    const linked = {
      id: 'activity:x',
      kind: 'activity' as const,
      provider: 'GitHub',
      label: '#3',
      url: 'https://github.com/o/r/issues/3',
      status: 'running'
    }
    const own = paneLinksOf({
      ...STATE,
      links: [linked],
      activity: { ...activity, running: false }
    })
    expect(own.find((one) => one.hotkey === 'a')).toMatchObject({
      label: 'Tambora TR-1',
      url: activity.url
    })
    const first = paneLinksOf({ ...STATE, links: [linked] })
    expect(first.find((one) => one.hotkey === 'a')).toMatchObject({
      label: '▶ GitHub #3',
      url: linked.url
    })
  })
})
