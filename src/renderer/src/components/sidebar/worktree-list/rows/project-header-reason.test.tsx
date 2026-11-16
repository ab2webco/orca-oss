// @vitest-environment happy-dom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProjectHeaderReason } from './project-header-reason'

function reasonOf(node: React.JSX.Element) {
  const { container } = render(node)
  const root = container.querySelector<HTMLElement>('[data-project-reason]')
  return {
    kind: root?.dataset.projectReason,
    tone: root?.querySelector<HTMLElement>('[data-status-tone]')?.dataset.statusTone,
    spinner: root?.querySelector('[data-agent-spinner]') !== null,
    text: root?.querySelector<HTMLElement>('[data-project-reason-text]')
  }
}

describe('ProjectHeaderReason', () => {
  it('names the questions in the attention tone with a dot, singular and plural', () => {
    const one = reasonOf(<ProjectHeaderReason reason={{ kind: 'questions', count: 1 }} />)
    expect(one.tone).toBe('attention')
    expect(one.spinner).toBe(false)
    expect(one.text?.textContent).toBe('1 question')
    expect(one.text?.className).toContain('text-status-attention')
    const two = reasonOf(<ProjectHeaderReason reason={{ kind: 'questions', count: 2 }} />)
    expect(two.text?.textContent).toBe('2 questions')
  })

  it('names an account limit in the attention tone', () => {
    const limited = reasonOf(<ProjectHeaderReason reason={{ kind: 'account-limit' }} />)
    expect(limited.kind).toBe('account-limit')
    expect(limited.tone).toBe('attention')
    expect(limited.text?.textContent).toBe('Account limited')
  })

  it('names failing CI in the warning tone', () => {
    const ci = reasonOf(<ProjectHeaderReason reason={{ kind: 'ci-failing' }} />)
    expect(ci.tone).toBe('warning')
    expect(ci.text?.textContent).toBe('CI failing')
    expect(ci.text?.className).toContain('text-status-warning')
  })

  it('counts running agents with the info spinner and muted text', () => {
    const working = reasonOf(<ProjectHeaderReason reason={{ kind: 'working', count: 2 }} />)
    expect(working.tone).toBe('info')
    expect(working.spinner).toBe(true)
    expect(working.text?.textContent).toBe('2 working')
    expect(working.text?.className).toContain('text-muted-foreground')
  })
})
