// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameOwnerReply } from '../../../../shared/orchestrator-game-owner-questions'
import { GameOwnerQuestionCard } from './GameOwnerQuestionCard'

const QUESTION = {
  id: 'oq_1',
  ticket: 'ORCA-12',
  question: 'Ship the arcade in lab.111?',
  options: ['Yes', 'Wait for lab.112'],
  context: 'https://example.test/pr/41',
  askedAt: '2026-10-29T10:00:00.000Z',
  answer: null
}

afterEach(() => {
  cleanup()
})

function pending() {
  let settle: (error?: Error) => void = () => {}
  const onAnswer = vi.fn(
    (_reply: GameOwnerReply) =>
      new Promise<void>((resolve, reject) => {
        settle = (error) => (error ? reject(error) : resolve())
      })
  )
  return { onAnswer, settle: (error?: Error) => settle(error) }
}

describe('GameOwnerQuestionCard', () => {
  it('shows the ticket, the question and its context, and answers by option number', async () => {
    const { onAnswer, settle } = pending()
    const view = render(<GameOwnerQuestionCard question={QUESTION} onAnswer={onAnswer} />)

    expect(view.getByText('ORCA-12')).toBeTruthy()
    expect(view.getByText('Ship the arcade in lab.111?')).toBeTruthy()
    expect(view.getByRole('button', { name: 'https://example.test/pr/41' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Wait for lab.112' }))

    expect(onAnswer).toHaveBeenCalledWith({ option: 2 })
    // Why: a second click while the host answers would send a different answer.
    expect(view.getByRole('button', { name: 'Yes' }).hasAttribute('disabled')).toBe(true)
    settle()
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Yes' }).hasAttribute('disabled')).toBe(false)
    )
  })

  it('sends a free-text answer, and only a non-empty one', () => {
    const { onAnswer } = pending()
    const view = render(<GameOwnerQuestionCard question={QUESTION} onAnswer={onAnswer} />)
    const send = view.getByRole('button', { name: 'Send' })
    expect(send.hasAttribute('disabled')).toBe(true)

    fireEvent.change(view.getByRole('textbox', { name: 'Your answer' }), {
      target: { value: '  Ship it, then review  ' }
    })
    fireEvent.click(send)

    expect(onAnswer).toHaveBeenCalledWith({ text: 'Ship it, then review' })
  })

  it('keeps a refused answer on the card so it can be read and retried', async () => {
    const { onAnswer, settle } = pending()
    const view = render(<GameOwnerQuestionCard question={QUESTION} onAnswer={onAnswer} />)

    fireEvent.click(view.getByRole('button', { name: 'Yes' }))
    settle(new Error('Question oq_1 is already answered: No'))

    expect(await view.findByRole('alert')).toBeTruthy()
    expect(view.getByRole('alert').textContent).toContain('already answered: No')
    expect(view.getByRole('button', { name: 'Yes' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows a context that is not a link as plain text', () => {
    const view = render(
      <GameOwnerQuestionCard
        question={{ ...QUESTION, ticket: null, context: 'See the lead pane' }}
        onAnswer={vi.fn()}
      />
    )

    expect(view.getByText('See the lead pane')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'See the lead pane' })).toBeNull()
  })
})
