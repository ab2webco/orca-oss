import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GAME_LEAD,
  DEFAULT_GAME_PUSH_PROMPT,
  defaultGameMemberCapOf,
  GAME_HOST_CAP_MAX,
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
        askBeforeResume: true,
        memberGame: false,
        cap: 3,
        agent: ' claude ',
        model: 'opus',
        effort: 'high',
        label: ' Orquestador ',
        launchPrompt: 'Implement {id}: {title}\n{url}',
        pushPrompt: ' Keep going on {id} ',
        rules: '  Report TERMINADO {id}.  '
      })
    ).toEqual({
      value: {
        autostart: true,
        askBeforeResume: true,
        memberGame: false,
        cap: 3,
        agent: 'claude',
        model: 'opus',
        effort: 'high',
        label: 'Orquestador',
        launchPrompt: 'Implement {id}: {title}\n{url}',
        pushPrompt: 'Keep going on {id}',
        rules: 'Report TERMINADO {id}.'
      },
      warnings: []
    })
  })

  it('takes accounts default or auto, and warns on anything else', () => {
    expect(parseGameLead({ accounts: ' auto ' })).toEqual({
      value: { accounts: 'auto' },
      warnings: []
    })
    expect(parseGameLead({ accounts: 'default' }).value).toEqual({ accounts: 'default' })
    expect(parseGameLead({ accounts: 'spread' })).toEqual({
      value: {},
      warnings: [
        'orchestratorGame.orchestrator.accounts must be default, auto, or a list of account emails or ids'
      ]
    })
  })

  it('takes accounts as a list of the accounts members may use, and warns on a bad entry', () => {
    expect(parseGameLead({ accounts: [' a@example.com ', 'acct_b'] })).toEqual({
      value: { accounts: ['a@example.com', 'acct_b'] },
      warnings: []
    })
    expect(parseGameLead({ accounts: [] }).warnings).toEqual([
      'orchestratorGame.orchestrator.accounts must be default, auto, or a list of account emails or ids'
    ])
    expect(parseGameLead({ accounts: ['a@example.com', 7] }).value).toEqual({})
  })

  it('takes memberNames as a roster and warns with the first bad name', () => {
    expect(parseGameLead({ memberNames: ['Mario', { en: 'Peach', es: 'Melocotón' }] })).toEqual({
      value: { memberNames: ['Mario', { en: 'Peach', es: 'Melocotón' }] },
      warnings: []
    })
    expect(parseGameLead({ memberNames: ['Mario', 'K-9'] })).toEqual({
      value: {},
      warnings: ['orchestratorGame.orchestrator.memberNames.1 must not look like a ticket id']
    })
    expect(parseGameLead({ memberNames: [] }).warnings).toEqual([
      'orchestratorGame.orchestrator.memberNames must list 1 to 24 names'
    ])
  })

  it('resolves accounts key by key, Settings over orca.yaml', () => {
    expect(resolveGameLead([undefined, { accounts: 'auto' }, undefined]).accounts).toBe('auto')
    expect(
      resolveGameLead([undefined, { accounts: 'auto' }, { accounts: 'default' }]).accounts
    ).toBe('default')
    expect(resolveGameLead([]).accounts).toBeUndefined()
  })

  it('drops each bad key with a warning and keeps the rest', () => {
    const parsed = parseGameLead({
      autostart: 'yes',
      askBeforeResume: 'no',
      memberGame: 'off',
      cap: GAME_LEAD_CAP_MAX + 1,
      agent: 'Claude Code',
      launchPrompt: 'Do {ticket}',
      pushPrompt: 'Resume {branch}',
      rules: '',
      label: 'Lead',
      color: 'red'
    })
    expect(parsed.value).toEqual({ label: 'Lead' })
    expect(parsed.warnings).toEqual([
      'orchestratorGame.orchestrator.autostart must be true or false',
      'orchestratorGame.orchestrator.askBeforeResume must be true or false',
      'orchestratorGame.orchestrator.memberGame must be true or false',
      `orchestratorGame.orchestrator.cap must be a whole number from 1 to ${GAME_LEAD_CAP_MAX}`,
      'orchestratorGame.orchestrator.agent must be an agent id like claude or codex',
      'orchestratorGame.orchestrator.launchPrompt uses an unknown placeholder {ticket}',
      'orchestratorGame.orchestrator.pushPrompt uses an unknown placeholder {branch}',
      'orchestratorGame.orchestrator.rules must be 1 to 4000 characters',
      'orchestratorGame.orchestrator.color is not a known setting'
    ])
  })

  it("takes actions as the switch for Orca's built-in lead buttons", () => {
    expect(parseGameLead({ actions: false })).toEqual({ value: { actions: false }, warnings: [] })
    expect(parseGameLead({ actions: 'no' })).toEqual({
      value: {},
      warnings: ['orchestratorGame.orchestrator.actions must be true or false']
    })
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

  it("takes the default cap from the machine, and a layer's cap still wins", () => {
    const big = { totalMemory: 64 * GIB, cpuCoreCount: 12 }

    expect(resolveGameLead([], big).cap).toBe(6)
    expect(resolveGameLead([{ cap: 2 }], big).cap).toBe(2)
  })
})

const GIB = 1024 ** 3

describe('defaultGameMemberCapOf', () => {
  it('gives two machines with different hardware different caps', () => {
    expect(defaultGameMemberCapOf({ totalMemory: 16 * GIB, cpuCoreCount: 8 })).toBe(4)
    expect(defaultGameMemberCapOf({ totalMemory: 36 * GIB, cpuCoreCount: 12 })).toBe(6)
  })

  it('is bound by whichever of memory and cores runs out first', () => {
    expect(defaultGameMemberCapOf({ totalMemory: 8 * GIB, cpuCoreCount: 16 })).toBe(2)
    expect(defaultGameMemberCapOf({ totalMemory: 128 * GIB, cpuCoreCount: 4 })).toBe(2)
  })

  it('stays within 1 and one machine’s ceiling', () => {
    expect(defaultGameMemberCapOf({ totalMemory: 2 * GIB, cpuCoreCount: 1 })).toBe(1)
    expect(defaultGameMemberCapOf({ totalMemory: 512 * GIB, cpuCoreCount: 96 })).toBe(
      GAME_HOST_CAP_MAX
    )
  })

  it('takes a project cap past one machine’s, as a ceiling over every host (ORCA-888)', () => {
    expect(parseGameLead({ cap: 30 }).value).toEqual({ cap: 30 })
  })

  it('falls back to the fixed default when the machine is unknown', () => {
    expect(defaultGameMemberCapOf(null)).toBe(DEFAULT_GAME_LEAD.cap)
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

  it('fills the default push prompt with the ticket id', () => {
    expect(renderGameLaunchPrompt(DEFAULT_GAME_PUSH_PROMPT, item)).toBe(
      'Continue CIN-12 to the end on your own. Report to your lead when it is done or when only the person can decide.'
    )
  })

  it('is the default work prompt without a template', () => {
    expect(renderGameLaunchPrompt(undefined, item)).toBe(
      'Work on CIN-12: Cartelera page\nhttps://jira/CIN-12'
    )
  })
})
