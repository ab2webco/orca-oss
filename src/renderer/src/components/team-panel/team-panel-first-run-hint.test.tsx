// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamFirstRunHint } from './team-panel-first-run-hint'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
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

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<TeamFirstRunHint />))
  return container
}

// ORCA-1304: a first-time user with no team saw nothing that said how to start one.
describe('TeamFirstRunHint', () => {
  it('says how to start a team: run the setup, start the lead, give it a ticket', async () => {
    const hint = (await render()).querySelector<HTMLElement>('[data-team-first-run]')!
    const commands = [...hint.querySelectorAll('code')].map((one) => one.textContent)

    expect(commands).toEqual(['/orca-game:setup', '/orca-game:lead'])
    expect(hint.textContent).toContain('Start a team')
    expect(hint.textContent).toContain('one member per ticket')
  })
})
