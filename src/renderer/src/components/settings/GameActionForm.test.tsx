// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameActionForm, gameActionProblemText, type GameActionFormState } from './GameActionForm'
import type { ActionDraft, ActionDraftProblem } from './orchestrator-game-action-drafts'

const DRAFT: ActionDraft = {
  label: '',
  command: '',
  key: '',
  kind: 'prompt',
  prompt: '',
  server: '',
  tool: '',
  args: '',
  icon: null,
  pin: true
}

const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

function render(
  initial: Partial<GameActionFormState>,
  problem: ActionDraftProblem | null = null,
  onRemove: (() => void) | null = null
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const handlers = { onSave: vi.fn(), onCancel: vi.fn() }
  let state: GameActionFormState = {
    draft: DRAFT,
    isNew: true,
    orca: false,
    commandTouched: false,
    ...initial
  }
  const draw = (): void =>
    act(() => {
      root.render(
        <GameActionForm
          state={state}
          problem={problem}
          onChange={(next) => {
            state = next
            draw()
          }}
          onRemove={onRemove}
          {...handlers}
        />
      )
    })
  draw()
  return { container, handlers, state: () => state }
}

const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string): void =>
  act(() => {
    const proto = Object.getPrototypeOf(input) as object
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const field = (container: HTMLElement, placeholder: string) =>
  container.querySelector<HTMLInputElement>(`[placeholder="${placeholder}"]`)!
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)

describe('GameActionForm', () => {
  it('derives the command from the name until the command is typed', () => {
    const { container, state } = render({})
    type(field(container, 'Deploy'), 'Ship It')
    expect(state().draft.command).toBe('ship-it')
    expect(container.textContent).toContain('/ship-it')
    type(field(container, 'deploy'), 'go')
    type(field(container, 'Deploy'), 'Ship it now')
    expect(state().draft).toMatchObject({ label: 'Ship it now', command: 'go' })
  })

  it("keeps an Orca action's command and kind fixed", () => {
    const { container, state } = render({
      draft: { ...DRAFT, label: 'Wave', command: 'wave' },
      isNew: false,
      orca: true
    })
    expect(field(container, 'deploy').readOnly).toBe(true)
    expect(container.querySelector('[aria-label="What it does"]')).toBeNull()
    type(field(container, 'Deploy'), 'Launch')
    expect(state().draft.command).toBe('wave')
    expect(button(container, 'Save')).toBeTruthy()
    expect(button(container, 'Create action')).toBeUndefined()
  })

  it('asks for the server and tool of an MCP action, and shows the problem with its field', () => {
    const { container } = render({ draft: { ...DRAFT, kind: 'mcp' } }, 'mcp')
    expect(field(container, 'plane').getAttribute('aria-invalid')).toBe('true')
    expect(field(container, 'list_work_items').getAttribute('aria-invalid')).toBe('true')
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Name the MCP server and tool.'
    )
  })

  it('picks an icon, saves, cancels, and offers Remove only when given one', () => {
    const remove = vi.fn()
    const { container, handlers, state } = render({ isNew: false }, null, remove)
    const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    act(() => radios[1]!.click())
    expect(state().draft.icon).not.toBeNull()
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true')
    act(() => button(container, 'Save')!.click())
    act(() => button(container, 'Cancel')!.click())
    act(() => button(container, 'Remove')!.click())
    expect(
      [handlers.onSave, handlers.onCancel, remove].map((one) => one.mock.calls.length)
    ).toEqual([1, 1, 1])
    expect(button(render({}).container, 'Remove')).toBeUndefined()
  })

  it('names each problem, with the taken command in its text', () => {
    expect(gameActionProblemText('commandTaken', 'deploy')).toBe('/deploy already exists.')
    expect(gameActionProblemText('args', '')).toBe(gameActionProblemText('key', ''))
  })
})
