// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamPanelModel,
  TeamPrList,
  TeamQueueEntry
} from '../../../../shared/team-panel-model-types'
import { TeamPanelPrsTab } from './team-panel-prs-tab'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))
vi.mock('./use-team-lead-prompt', () => ({ useTeamLeadPrompt: () => null }))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

const entry = (position: number): TeamQueueEntry => ({
  label: `#${950 + position}`,
  title: `Queued ${position}`,
  url: `https://example.test/${950 + position}`,
  position,
  state: position === 1 ? 'checks' : 'waiting',
  status: 'working',
  since: null,
  longWaitHours: null,
  memberKey: null
})

const PRS: TeamPrList = {
  rows: [
    {
      label: '#7',
      number: 7,
      title: 'Fix',
      url: 'https://example.test/7',
      status: 'working',
      reason: 'inReview',
      memberKey: null
    }
  ],
  total: 1,
  listUrl: null,
  listAction: null
}

async function render(queue: TeamPanelModel['queue'], prs: TeamPanelModel['prs'] = null) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const model = { kind: 'team', queue, prs } as TeamPanelModel
  await act(async () =>
    root.render(<TeamPanelPrsTab value={PRS} model={model} selectTab={() => {}} />)
  )
  return container
}

describe('TeamPanelPrsTab', () => {
  it('opens with the merge queue, its first four in order, then the pull requests', async () => {
    const container = await render({ kind: 'ready', value: [1, 2, 3, 4, 5].map(entry) })

    expect(container.querySelector('[data-team-queue-title]')?.textContent).toBe('Merge queue · 5')
    const rows = [...container.querySelectorAll('[data-team-queue],[data-team-pr]')].map(
      (one) => one.getAttribute('data-team-queue') ?? one.getAttribute('data-team-pr')
    )
    expect(rows).toEqual(['#951', '#952', '#953', '#954', '#7'])
  })

  it('keeps the queue when the pull requests could not be read, and says so under it', async () => {
    const container = await render(
      { kind: 'ready', value: [entry(1)] },
      { kind: 'error', message: 'rate limited' }
    )

    expect(container.querySelector('[data-team-queue="#951"]')).not.toBeNull()
    expect(container.querySelector('[data-team-pr-failure]')?.textContent).toBe(
      'Could not read pull requests · rate limited'
    )
  })

  it('draws no queue part when the project has no queue or it is empty', async () => {
    const queues: TeamPanelModel['queue'][] = [
      null,
      { kind: 'unavailable' },
      { kind: 'ready', value: [] }
    ]
    for (const queue of queues) {
      const container = await render(queue)
      expect(container.querySelector('[data-team-queue-title]')).toBeNull()
      expect(container.querySelector('[data-team-pr="#7"]')).not.toBeNull()
    }
  })
})
