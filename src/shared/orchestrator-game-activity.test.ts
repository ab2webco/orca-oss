import { describe, expect, it } from 'vitest'
import { builtInGameActivityRules, gameActivityOf } from './orchestrator-game-activity'
import { compileGameActivityRule } from './orchestrator-game-integrations'
import type { GameReview, GameWorkItem } from './orchestrator-game-state'

const plane: GameWorkItem = {
  provider: 'plane',
  identifier: 'ORCA-586',
  title: 'Game links',
  url: 'https://app.plane.so/ws/browse/ORCA-586/',
  status: 'In Progress',
  statusGroup: 'in_progress'
}

const github: GameReview = {
  provider: 'github',
  number: 42,
  title: 'feat',
  url: 'https://github.com/o/r/pull/42',
  state: 'open',
  ci: 'pending'
}

const call = (toolName: string, input: string, result = '', at = 1, running = false) => ({
  toolName,
  input,
  result,
  at,
  running
})

describe('builtInGameActivityRules', () => {
  it("links a work item key of the same project through Orca's own work item URL", () => {
    const rules = builtInGameActivityRules({ workItem: plane, review: null })

    expect(
      gameActivityOf([call('mcp__plane__retrieve_work_item', '{"id":"ORCA-12"}')], rules)
    ).toEqual({
      name: 'Plane',
      id: 'ORCA-12',
      url: 'https://app.plane.so/ws/browse/ORCA-12/',
      at: 1,
      running: false
    })
    expect(gameActivityOf([call('mcp__plane__list', '"UTF-8" WEB-3')], rules)).toBeNull()
  })

  it('drops the title slug of a Linear URL and keeps a Jira site', () => {
    const linear = builtInGameActivityRules({
      workItem: {
        ...plane,
        provider: 'linear',
        identifier: 'ENG-1',
        url: 'https://linear.app/acme/issue/ENG-1/fix-it'
      },
      review: null
    })
    const jira = builtInGameActivityRules({
      workItem: {
        ...plane,
        provider: 'jira',
        identifier: 'CIN-7',
        url: 'https://acme.atlassian.net/browse/CIN-7'
      },
      review: null
    })

    expect(gameActivityOf([call('mcp__linear__get_issue', 'ENG-9')], linear)?.url).toBe(
      'https://linear.app/acme/issue/ENG-9'
    )
    expect(
      gameActivityOf([call('mcp__claude_ai_Atlassian__getJiraIssue', 'CIN-8')], jira)?.url
    ).toBe('https://acme.atlassian.net/browse/CIN-8')
  })

  it('links a pull request or issue number a GitHub MCP call names in the review repo', () => {
    const rules = builtInGameActivityRules({ workItem: null, review: github })

    expect(
      gameActivityOf([call('mcp__github__get_pull_request', '{"pullNumber":7}')], rules)
    ).toMatchObject({ name: 'GitHub', id: '#7', url: 'https://github.com/o/r/pull/7' })
    expect(
      gameActivityOf([call('mcp__github__get_issue', '{"issue_number":"9"}')], rules)
    ).toMatchObject({ id: '#9', url: 'https://github.com/o/r/issues/9' })
  })

  it('knows no host, and adds no rule, without a work item or review', () => {
    expect(builtInGameActivityRules({ workItem: null, review: null })).toEqual([])
    expect(builtInGameActivityRules({ workItem: { ...plane, url: '' }, review: null })).toEqual([])
  })
})

describe('gameActivityOf', () => {
  const tambora = compileGameActivityRule({
    name: 'Tambora run',
    tools: 'mcp__tambora__*',
    match: 'TR-([A-Z]+)-\\d+',
    url: 'https://tambora.example/projects/{1}/testruns/{0}'
  })
  const rules = tambora ? [tambora] : []

  it('takes the newest call that matches and says whether it is still running', () => {
    expect(
      gameActivityOf(
        [
          call('mcp__tambora__list_test_cases', '{}', 'none', 3),
          call('mcp__tambora__add_test_run_results', '{"run":"TR-CIN-13"}', '', 2, true),
          call('mcp__tambora__create_test_run', '{}', 'TR-CIN-12', 1)
        ],
        rules
      )
    ).toEqual({
      name: 'Tambora run',
      id: 'TR-CIN-13',
      url: 'https://tambora.example/projects/CIN/testruns/TR-CIN-13',
      at: 2,
      running: true
    })
  })
})
