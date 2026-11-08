// @vitest-environment happy-dom

import { StrictMode, act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamAction } from '../../../../shared/team-panel-actions'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TeamActionMenu, type TeamActionMenuProps } from './TeamActionMenu'

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
  command: null,
  pin: false,
  send: 'x',
  now: null,
  off: null,
  ...overrides
})

const ACTIONS: TeamAction[] = [
  action({ id: 'lead:wave', orca: 'wave', label: 'Wave', command: 'wave', off: 'nothingToDo' }),
  action({ id: 'lead:push', orca: 'push', label: 'Push', command: 'push', now: { count: 2 } }),
  action({ id: 'lead:status', orca: 'status', label: 'Status', command: 'status' }),
  action({ id: 'lead:stop', orca: 'stop', label: 'Stop', command: 'stop' }),
  action({ id: 'action-0', label: 'Release', command: 'release', pin: true }),
  action({ id: 'action-1', label: 'Runs', send: null, off: 'noNativePath' })
]

async function render(overrides: Partial<TeamActionMenuProps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const props: TeamActionMenuProps = {
    actions: ACTIONS,
    disabled: false,
    onRun: vi.fn(),
    onStop: vi.fn(),
    onNewAction: vi.fn(),
    onEditActions: vi.fn(),
    ...overrides
  }
  await act(async () => {
    root.render(
      <TooltipProvider>
        <TeamActionMenu {...props} />
      </TooltipProvider>
    )
  })
  const open = async () =>
    act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="All actions"]')?.click()
    })
  return { container, props, open }
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
const rows = () =>
  [...(menu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].map((row) => ({
    text: row.textContent,
    disabled: row.disabled
  }))
const groups = () => [...(menu()?.querySelectorAll('h4') ?? [])].map((one) => one.textContent)

describe('TeamActionMenu', () => {
  it('groups every action under Now, This project and From Orca, with why or its command', async () => {
    const { open } = await render()
    await open()
    expect(document.activeElement?.getAttribute('placeholder')).toBe('Search actions')
    expect(groups()).toEqual(['Now', 'This project', 'From Orca'])
    expect(rows()).toEqual([
      { text: 'Push2 stopped', disabled: false },
      { text: 'Release/release', disabled: false },
      { text: 'RunsRuns from the terminal', disabled: true },
      { text: 'WaveNothing to do', disabled: true },
      { text: 'Status/status', disabled: false },
      { text: 'Stop/stop', disabled: false }
    ])
  })

  it('filters by name or command, and says when nothing matches', async () => {
    const { open } = await render()
    await open()
    const search = document.activeElement as HTMLInputElement
    const type = async (value: string) =>
      act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(search, value)
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await type('REL')
    expect(rows().map((one) => one.text)).toEqual(['Release/release'])
    await type('zzz')
    expect(rows()).toEqual([])
    expect(menu()?.textContent).toContain('No action with that name.')
  })

  it('runs a row and closes, asks before Stop, and opens Settings from the footer', async () => {
    const { props, open } = await render()
    const press = async (text: string) =>
      act(async () => {
        ;[...(menu()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
          .find((one) => one.textContent?.startsWith(text))
          ?.click()
      })
    await open()
    await press('Release')
    expect(props.onRun).toHaveBeenCalledWith(ACTIONS[4])
    expect(menu()).toBeNull()
    await open()
    await press('Stop')
    expect(props.onStop).toHaveBeenCalled()
    expect(props.onRun).toHaveBeenCalledTimes(1)
    await open()
    await press('New action')
    expect(props.onNewAction).toHaveBeenCalled()
    await open()
    await press('Edit')
    expect(props.onEditActions).toHaveBeenCalled()
  })

  // Why StrictMode: the dev app replays refs on mount, which left Radix measuring a detached trigger.
  it('opens over the dock it spans, under StrictMode too', async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const dock = this.matches('[data-dock]')
        return DOMRect.fromRect(dock ? { x: 980, y: 800, width: 300, height: 44 } : {})
      })
    function Dock(): React.JSX.Element {
      const dock = useRef<HTMLElement>(null)
      return (
        <section ref={dock} data-dock="">
          <TeamActionMenu
            actions={ACTIONS}
            disabled={false}
            anchor={dock}
            onRun={vi.fn()}
            onStop={vi.fn()}
            onNewAction={vi.fn()}
            onEditActions={vi.fn()}
          />
        </section>
      )
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () =>
      root.render(
        <StrictMode>
          <TooltipProvider>
            <Dock />
          </TooltipProvider>
        </StrictMode>
      )
    )
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="All actions"]')?.click()
    })
    await vi.waitFor(() => {
      const wrapper = document.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]')
      expect(wrapper?.style.getPropertyValue('--radix-popper-anchor-width')).toBe('300px')
    })
    rect.mockRestore()
  })

  it('closes on Escape from its search even when a hint opened after it is the top layer', async () => {
    const { container, open } = await render()
    await open()
    const hint = document.createElement('div')
    document.body.appendChild(hint)
    const hintRoot = createRoot(hint)
    roots.push(hintRoot)
    // Why a controlled hint: like the board hint, it swallows Escape and never closes on it.
    await act(async () =>
      hintRoot.render(
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Board</TooltipTrigger>
            <TooltipContent>Moved</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    )
    const search = menu()!.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(container.querySelector('[aria-label="All actions"]')).not.toBeNull()
  })
})
