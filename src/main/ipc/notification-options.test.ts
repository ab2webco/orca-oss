// ORCA-1131: a Spanish UI showed "Claude finished", "the lead asks you" and "Using AskUserQuestion".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getLocale: vi.fn(() => 'en-US') } }))

import { UI_LANGUAGE_ENGLISH, UI_LANGUAGE_SPANISH } from '../../shared/ui-language'
import { ensureMainI18n, setMainUiLanguage } from '../i18n/main-i18n'
import { buildNotificationOptions } from './notification-options'

const finished = {
  source: 'agent-task-complete',
  worktreeId: 'wt-1',
  worktreeLabel: 'main',
  repoLabel: 'solo-repo',
  agentType: 'claude',
  agentState: 'done'
} as const

describe('buildNotificationOptions in the UI language', () => {
  beforeEach(async () => {
    await ensureMainI18n()
    await setMainUiLanguage(UI_LANGUAGE_SPANISH)
  })

  afterEach(async () => {
    await setMainUiLanguage(UI_LANGUAGE_ENGLISH)
  })

  it('titles a finished, waiting and stopped agent in Spanish', () => {
    expect(buildNotificationOptions(finished).title).toBe('main - Claude terminó')
    expect(buildNotificationOptions({ ...finished, agentState: 'waiting' }).title).toBe(
      'main - Claude necesita tu respuesta'
    )
    expect(
      buildNotificationOptions({ ...finished, agentState: 'done', agentInterrupted: true }).title
    ).toBe('main - Claude se detuvo')
  })

  it('describes the tool in Spanish', () => {
    expect(
      buildNotificationOptions({
        ...finished,
        agentState: 'waiting',
        agentToolName: 'AskUserQuestion'
      }).body
    ).toBe('Usando AskUserQuestion')
  })

  it('asks the owner in Spanish', () => {
    const options = buildNotificationOptions({
      source: 'game-owner-question',
      worktreeId: 'wt-1',
      repoLabel: 'team-repo',
      ownerQuestion: 'Merge now?'
    })
    expect(options.title).toBe('team-repo: el líder te pregunta')
    expect(options.body).toBe('Merge now?')
  })

  it('keeps the English copy in English', async () => {
    await setMainUiLanguage(UI_LANGUAGE_ENGLISH)
    expect(buildNotificationOptions(finished).title).toBe('main - Claude finished')
    expect(
      buildNotificationOptions({
        ...finished,
        agentState: 'waiting',
        agentToolName: 'AskUserQuestion'
      }).body
    ).toBe('Using AskUserQuestion')
  })
})
