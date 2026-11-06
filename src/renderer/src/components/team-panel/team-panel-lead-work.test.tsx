// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  TeamLeadAction,
  TeamLeadWork,
  TeamTodoList,
  TeamTodoRow
} from '../../../../shared/team-panel-lead-work'
import { TeamLeadWorkSections, type SendToLead } from './team-panel-lead-work'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    Object.entries(options ?? {}).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
      fallback
    )
}))

let root: Root | null = null
let host: HTMLElement | null = null

function mount(work: TeamLeadWork, send: SendToLead | null = vi.fn<SendToLead>()): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <TooltipProvider>
        <TeamLeadWorkSections work={work} send={send} />
      </TooltipProvider>
    )
  )
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const row = (over: Partial<TeamTodoRow> = {}): TeamTodoRow => ({
  id: 'ORCA-1',
  title: 'Fix the panel',
  url: 'https://tracker.test/ORCA-1',
  prompt: 'Work on ORCA-1',
  ...over
})

const list = (over: Partial<TeamTodoList> = {}): TeamTodoList => ({
  groups: [{ heading: 'in_progress', count: 2, rows: [row()] }],
  total: 2,
  hidden: 1,
  listUrl: 'https://tracker.test/board',
  listAction: null,
  ...over
})

const WAVE: TeamLeadAction = { id: 'lead:wave', label: 'Wave', prompt: 'Run a wave' }
const DEPLOY: TeamLeadAction = { id: 'action-0', label: 'Deploy', prompt: 'Deploy it' }

const press = (element: Element | null | undefined): void => {
  act(() => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('TeamLeadWorkSections', () => {
  it('draws nothing with no To Do and no actions', () => {
    expect(mount({ todo: null, actions: [] }).querySelector('[data-team-lead-work]')).toBeNull()
  })

  it('draws nothing when actions are all it has and no lead pane can take them', () => {
    expect(
      mount({ todo: null, actions: [WAVE] }, null).querySelector('[data-team-lead-work]')
    ).toBe(null)
  })

  it('draws the tickets under their status with the count of all of them', () => {
    const body = mount({ todo: list(), actions: [] })

    expect(body.querySelector('[data-team-todo-heading]')?.textContent).toBe('In progress2')
    const link = body.querySelector<HTMLAnchorElement>('[data-team-todo="ORCA-1"] a')
    expect(link?.getAttribute('href')).toBe('https://tracker.test/ORCA-1')
    expect(link?.textContent).toContain('Fix the panel')
  })

  it('sends the lead the ticket\'s prompt on "work on"', () => {
    const send = vi.fn<SendToLead>()
    const body = mount({ todo: list(), actions: [] }, send)

    press(body.querySelector('[aria-label="Work on ORCA-1"]'))

    expect(send).toHaveBeenCalledWith('work-ORCA-1', 'Work on ORCA-1', 'Work on ORCA-1')
  })

  it('draws no "work on" on a ticket with no prompt', () => {
    const groups = [{ heading: null, count: null, rows: [row({ prompt: null })] }]
    const body = mount({ todo: list({ groups }), actions: [] })

    expect(body.querySelector('[aria-label="Work on ORCA-1"]')).toBeNull()
  })

  it('keeps the tickets and drops what sends with no lead pane to send to', () => {
    const body = mount({ todo: list(), actions: [WAVE] }, null)

    expect(body.querySelector('[data-team-todo="ORCA-1"]')).not.toBeNull()
    expect(body.querySelector('[aria-label="Work on ORCA-1"]')).toBeNull()
    expect(body.querySelector('[data-team-action]')).toBeNull()
  })

  it('opens the full list for the tickets past the ones drawn', () => {
    const body = mount({ todo: list(), actions: [] })

    const more = body.querySelector<HTMLAnchorElement>('[data-team-todo-more]')
    expect(more?.getAttribute('href')).toBe('https://tracker.test/board')
    expect(more?.textContent).toBe('View all 2')
  })

  it("runs the list's action instead of opening it", () => {
    const send = vi.fn<SendToLead>()
    const body = mount({ todo: list({ listAction: DEPLOY }), actions: [] }, send)

    press(body.querySelector('[data-team-todo-more]'))

    expect(send).toHaveBeenCalledWith('action-0', 'Deploy it', 'Deploy')
    expect(body.querySelector('a[data-team-todo-more]')).toBeNull()
  })

  it('counts the rest when there is no list to open', () => {
    const body = mount({ todo: list({ listUrl: null }), actions: [] })

    expect(body.querySelector('[data-team-todo-more]')?.textContent).toBe('+1 more')
  })

  it('says so when the To Do is empty', () => {
    const body = mount({ todo: list({ groups: [], total: 0, hidden: 0 }), actions: [] })

    expect(body.textContent).toContain('Nothing to do')
  })

  it('draws a project action with the label it wrote and a built-in in the session language', () => {
    const body = mount({ todo: null, actions: [WAVE, DEPLOY] })

    const labels = [...body.querySelectorAll('[data-team-action]')].map((one) => one.textContent)
    expect(labels).toEqual(['Wave', 'Deploy'])
  })

  it("sends the lead an action's prompt", () => {
    const send = vi.fn<SendToLead>()
    const body = mount({ todo: null, actions: [WAVE] }, send)

    press(body.querySelector('[data-team-action="lead:wave"]'))

    expect(send).toHaveBeenCalledWith('lead:wave', 'Run a wave', 'Wave')
  })
})
