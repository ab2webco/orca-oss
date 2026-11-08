import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' } }))

const { buildNotificationOptions } = await import('./notification-options')
const { setMainUiLanguage } = await import('../i18n/main-i18n')
const { UI_LANGUAGE_ENGLISH, UI_LANGUAGE_SPANISH } = await import('../../shared/ui-language')

const waiting = {
  source: 'agent-task-complete' as const,
  agentType: 'claude' as const,
  agentState: 'waiting' as const,
  worktreeLabel: 'orca-1129',
  agentToolName: 'AskUserQuestion',
  agentToolInput: '{"questions":[...]}'
}

// Why (ORCA-1129 D6): the only alert a no-team question gets read "Using AskUserQuestion".
describe('an agent question notification', () => {
  beforeAll(() => setMainUiLanguage(UI_LANGUAGE_ENGLISH))
  afterAll(() => setMainUiLanguage(UI_LANGUAGE_ENGLISH))

  it('shows the question, never the tool name', () => {
    const options = buildNotificationOptions({ ...waiting, agentQuestion: 'Merge #923 now?' })

    expect(options).toMatchObject({
      title: 'orca-1129 - Claude asks you',
      body: 'Merge #923 now?'
    })
    expect(`${options.title} ${options.body}`).not.toContain('AskUserQuestion')
  })

  it('points to the Inbox when the question could not be read', () => {
    expect(buildNotificationOptions({ ...waiting, agentQuestion: '' }).body).toBe(
      'Open the Inbox to answer.'
    )
  })

  it('reads in the language Orca is set to', async () => {
    await setMainUiLanguage(UI_LANGUAGE_SPANISH)

    expect(buildNotificationOptions({ ...waiting, agentQuestion: '' })).toMatchObject({
      title: 'orca-1129 - Claude te pregunta',
      body: 'Abre la Bandeja para responder.'
    })
  })
})
