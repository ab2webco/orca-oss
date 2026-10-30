import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { RuntimeClient, RuntimeClientError } from '../../src/cli/runtime-client'
import type { GameOwnerQuestion } from '../../src/shared/orchestrator-game-owner-questions'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'

// The lead's questions to the person are records the host keeps, not chat text (ORCA-782).
test('a question asked of the person is kept, counted in game state and answered once', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)

  const asked = await client.call<{ question: GameOwnerQuestion }>('game.ownerAsk', {
    worktreeId,
    ticket: 'orca-782',
    question: 'Ship the arcade in lab.111?',
    options: ['Yes', 'Wait for lab.112'],
    context: 'PR #41'
  })
  const { id } = asked.result.question
  expect(asked.result.question).toMatchObject({ ticket: 'ORCA-782', answer: null })

  const listed = await client.call<{ questions: GameOwnerQuestion[]; open: number }>(
    'game.ownerQuestions',
    { worktreeId }
  )
  expect(listed.result).toMatchObject({ open: 1, questions: [{ id }] })
  const state = await client.call<OrchestratorGameState>('game.state', { worktreeId })
  expect(state.result.openOwnerQuestions).toBe(1)

  const answered = await client.call<{ question: GameOwnerQuestion; repeated: boolean }>(
    'game.ownerAnswer',
    { worktreeId, id, option: 2 }
  )
  expect(answered.result).toMatchObject({
    question: { answer: { text: 'Wait for lab.112' } },
    repeated: false
  })
  const again = await client.call<{ repeated: boolean }>('game.ownerAnswer', {
    worktreeId,
    id,
    option: 2
  })
  expect(again.result.repeated).toBe(true)
  const refused = await client
    .call('game.ownerAnswer', { worktreeId, id, text: 'Yes' })
    .then(() => null)
    .catch((error: unknown) => error)
  expect(refused).toBeInstanceOf(RuntimeClientError)
  expect((refused as RuntimeClientError).message).toContain('already answered: Wait for lab.112')

  const after = await client.call<{ questions: GameOwnerQuestion[]; open: number }>(
    'game.ownerQuestions',
    { worktreeId, all: true }
  )
  expect(after.result).toMatchObject({ open: 0, questions: [{ id }] })
  expect(
    (await client.call<OrchestratorGameState>('game.state', { worktreeId })).result
      .openOwnerQuestions
  ).toBe(0)
})
