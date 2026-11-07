// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamAction } from '../../../../shared/team-panel-actions'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TeamActionDock, type TeamActionDockProps } from './TeamActionDock'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name]))
}))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

const action = (overrides: Partial<TeamAction>): TeamAction => ({
  id: 'x',
  orca: null,
  label: 'X',
  icon: null,
  pin: false,
  send: 'x',
  now: null,
  off: null,
  ...overrides
})

const ACTIONS: TeamAction[] = [
  action({ id: 'lead:wave', orca: 'wave', label: 'Wave', icon: 'launch', now: { count: 4 } }),
  action({ id: 'lead:status', orca: 'status', label: 'Status', icon: 'pulse' }),
  action({ id: 'lead:sweep', orca: 'sweep', label: 'Sweep', off: 'nothingToClose' }),
  action({ id: 'lead:stop', orca: 'stop', label: 'Stop', icon: 'stop', send: 'Stop all' }),
  action({ id: 'action-0', label: 'Release', icon: 'tag', pin: true, send: 'Prepare it' }),
  action({ id: 'action-1', label: 'Board', send: '/board' })
]

async function render(overrides: Partial<TeamActionDockProps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const props: TeamActionDockProps = {
    actions: ACTIONS,
    memberCount: 3,
    lead: { state: 'idle', stateStartedAt: 0, reply: null },
    onRun: vi.fn(async () => true),
    onOpenLead: vi.fn(),
    ...overrides
  }
  const draw = async (next: Partial<TeamActionDockProps>) => {
    Object.assign(props, next)
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TeamActionDock {...props} />
        </TooltipProvider>
      )
    })
  }
  await draw({})
  return { container, props, draw }
}

const buttons = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>('[data-team-action]')
]
const click = async (node: Element | null | undefined) =>
  act(async () => {
    ;(node as HTMLElement | null)?.click()
  })

describe('TeamActionDock', () => {
  it('shows what applies now with its count and the pinned project actions, then Stop', async () => {
    const { container } = await render()
    expect(buttons(container).map((one) => one.textContent)).toEqual(['Wave4', 'Release'])
    // Why: the name a reader or a sweep hears is the label and why, never "Wave4".
    expect(
      buttons(container).map((one) => one.getAttribute('aria-label') ?? one.textContent)
    ).toEqual(['Wave, 4 to do, slots free', 'Release'])
    const stop = container.querySelector('[aria-label="Stop every member"]')
    expect(stop).not.toBeNull()
    expect(container.textContent).not.toContain('Board')
  })

  it("runs a chip, holds the others while the lead works, then shows the lead's reply", async () => {
    const { container, props, draw } = await render()
    const now = Date.now()
    await click(buttons(container)[1])
    expect(props.onRun).toHaveBeenCalledWith(ACTIONS[4])
    expect(buttons(container)[0]?.disabled).toBe(true)
    expect(container.querySelector('[aria-label="Stop every member"]')).toHaveProperty(
      'disabled',
      true
    )

    await draw({ lead: { state: 'working', stateStartedAt: now + 1000, reply: null } })
    expect(container.textContent).not.toContain('See reply')
    await draw({
      lead: { state: 'done', stateStartedAt: now + 2000, reply: 'Two PRs left to merge.\nMore' }
    })
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Release: Two PRs left to merge.'
    )
    expect(buttons(container)[0]?.disabled).toBe(false)
    await click(
      [...container.querySelectorAll('button')].find((one) => one.textContent === 'See reply')
    )
    expect(props.onOpenLead).toHaveBeenCalled()
  })

  it('asks before Stop, inline, and sends it only on confirm', async () => {
    const { container, props } = await render()
    await click(container.querySelector('[aria-label="Stop every member"]'))
    expect(container.textContent).toContain(
      'Stop all 3 members? They stay stopped until you push them.'
    )
    const byText = (text: string) =>
      [...container.querySelectorAll('button')].find((one) => one.textContent === text)
    await click(byText('Cancel'))
    expect(props.onRun).not.toHaveBeenCalled()
    await click(container.querySelector('[aria-label="Stop every member"]'))
    await click(byText('Stop'))
    expect(props.onRun).toHaveBeenCalledWith(ACTIONS[3])
  })

  it('hides a chip that stops fitting when a count grows, with no resize', async () => {
    // Why a fake layout: happy-dom lays nothing out; each chip is 10 px per character, the row 120.
    const rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        if (!this.hasAttribute('data-team-action')) {
          return { right: 120 } as DOMRect
        }
        const before = [...(this.parentElement?.children ?? [])].slice(
          0,
          [...(this.parentElement?.children ?? [])].indexOf(this) + 1
        )
        return {
          right: before.reduce((sum, one) => sum + (one.textContent?.length ?? 0) * 10, 0)
        } as DOMRect
      })
    try {
      const { container, draw } = await render()
      expect(container.querySelectorAll('[data-team-action][aria-hidden]')).toHaveLength(0)
      const wave = { ...ACTIONS[0]!, now: { count: 1234 } }
      await draw({ actions: [wave, ...ACTIONS.slice(1)] })
      expect(
        [...container.querySelectorAll('[data-team-action][aria-hidden]')].map(
          (one) => one.textContent
        )
      ).toEqual(['Release'])
    } finally {
      rect.mockRestore()
    }
  })

  it('disables Stop with its reason, and draws nothing without actions', async () => {
    const stopped = ACTIONS.map((one) =>
      one.orca === 'stop' ? { ...one, off: 'alreadyStopped' as const } : one
    )
    const { container } = await render({ actions: stopped })
    expect(container.querySelector('[aria-label="Already stopped"]')).toHaveProperty(
      'disabled',
      true
    )
    const empty = await render({ actions: [] })
    expect(empty.container.querySelector('section')).toBeNull()
  })
})
