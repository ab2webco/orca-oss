import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GAME_LEAD,
  GAME_LEAD_CAP_MAX,
  parseGameLead,
  renderGameLaunchPrompt,
  resolveGameLead
} from './orchestrator-game-lead'

describe('parseGameLead', () => {
  it('keeps every valid key, trimmed', () => {
    expect(
      parseGameLead({
        autostart: true,
        cap: 3,
        agent: ' claude ',
        model: 'opus',
        effort: 'high',
        label: ' Orquestador ',
        launchPrompt: 'Implement {id}: {title}\n{url}',
        rules: '  Report TERMINADO {id}.  '
      })
    ).toEqual({
      value: {
        autostart: true,
        cap: 3,
        agent: 'claude',
        model: 'opus',
        effort: 'high',
        label: 'Orquestador',
        launchPrompt: 'Implement {id}: {title}\n{url}',
        rules: 'Report TERMINADO {id}.'
      },
      warnings: []
    })
  })

  it('drops each bad key with a warning and keeps the rest', () => {
    const parsed = parseGameLead({
      autostart: 'yes',
      cap: GAME_LEAD_CAP_MAX + 1,
      agent: 'Claude Code',
      launchPrompt: 'Do {ticket}',
      rules: '',
      label: 'Lead',
      color: 'red'
    })
    expect(parsed.value).toEqual({ label: 'Lead' })
    expect(parsed.warnings).toEqual([
      'orchestratorGame.orchestrator.autostart must be true or false',
      `orchestratorGame.orchestrator.cap must be a whole number from 1 to ${GAME_LEAD_CAP_MAX}`,
      'orchestratorGame.orchestrator.agent must be an agent id like claude or codex',
      'orchestratorGame.orchestrator.launchPrompt uses an unknown placeholder {ticket}',
      'orchestratorGame.orchestrator.rules must be 1 to 4000 characters',
      'orchestratorGame.orchestrator.color is not a known setting'
    ])
  })

  it('refuses a non-mapping', () => {
    expect(parseGameLead(['claude'])).toEqual({
      value: undefined,
      warnings: ['orchestratorGame.orchestrator must be a mapping']
    })
  })
})

describe('resolveGameLead', () => {
  it('is the default with no layer', () => {
    expect(resolveGameLead([])).toEqual(DEFAULT_GAME_LEAD)
  })

  it('lets a later layer win key by key', () => {
    expect(
      resolveGameLead([
        { cap: 2, agent: 'codex', rules: 'Team rules' },
        undefined,
        { cap: 5, label: 'Boss' }
      ])
    ).toEqual({ ...DEFAULT_GAME_LEAD, cap: 5, agent: 'codex', rules: 'Team rules', label: 'Boss' })
  })

  it('drops an effort that has no model, as worker-start would refuse it', () => {
    expect(resolveGameLead([{ effort: 'high' }])).toEqual(DEFAULT_GAME_LEAD)
  })
})

describe('renderGameLaunchPrompt', () => {
  const item = { id: 'CIN-12', title: 'Cartelera page', url: 'https://jira/CIN-12' }

  it('fills the project template', () => {
    expect(renderGameLaunchPrompt('/implement {id}\n{title} {url}', item)).toBe(
      '/implement CIN-12\nCartelera page https://jira/CIN-12'
    )
  })

  it('keeps the template when a value is unknown, leaving it empty', () => {
    expect(
      renderGameLaunchPrompt('/implement {id}\nNow: {status}\n{title}', { ...item, title: '' })
    ).toBe('/implement CIN-12\nNow:\n')
  })

  it('is the default work prompt without a template', () => {
    expect(renderGameLaunchPrompt(undefined, item)).toBe(
      'Work on CIN-12: Cartelera page\nhttps://jira/CIN-12'
    )
  })
})
