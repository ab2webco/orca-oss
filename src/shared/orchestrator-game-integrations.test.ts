import { describe, expect, it } from 'vitest'
import { resolveOrchestratorGameIntegrations } from './orchestrator-game-config'
import {
  compileGameActivityRule,
  matchGameActivity,
  parseGameActivityRules,
  parseGameLinkTemplates,
  renderGameUrlTemplate
} from './orchestrator-game-integrations'

const TAMBORA = {
  name: 'Tambora run',
  tools: 'mcp__tambora__*',
  match: 'TR-([A-Z]+)-\\d+',
  url: 'https://tambora.example/projects/{1}/testruns/{0}'
}

describe('parseGameLinkTemplates', () => {
  it('keeps valid links and trims their labels', () => {
    expect(
      parseGameLinkTemplates([
        { label: ' Board ', url: 'https://plane.example/ws/projects/1' },
        { label: 'Ticket', url: 'https://jira.example/browse/{workItem.identifier}' }
      ])
    ).toEqual({
      value: [
        { label: 'Board', url: 'https://plane.example/ws/projects/1' },
        { label: 'Ticket', url: 'https://jira.example/browse/{workItem.identifier}' }
      ],
      warnings: []
    })
  })

  it('drops links that are not http(s), put a placeholder in the host, or name unknown fields', () => {
    const parsed = parseGameLinkTemplates([
      { label: 'Script', url: 'javascript:alert(1)' },
      { label: 'Host', url: 'https://{branch}.example/x' },
      { label: 'Scheme', url: '{workItem.provider}://x' },
      { label: 'Login', url: 'https://good.example@evil.example/x' },
      { label: 'Secret', url: 'https://x.example/{env.TOKEN}' },
      { label: 'A label far longer than twenty-four', url: 'https://x.example' }
    ])

    expect(parsed.value).toEqual([])
    expect(parsed.warnings).toEqual([
      'orchestratorGame.links[0].url must be an http(s) URL with a literal host',
      'orchestratorGame.links[1].url must be an http(s) URL with a literal host',
      'orchestratorGame.links[2].url must be an http(s) URL with a literal host',
      'orchestratorGame.links[3].url must be an http(s) URL with a literal host',
      'orchestratorGame.links[4].url uses an unknown placeholder {env.TOKEN}',
      'orchestratorGame.links[5].label must be 1 to 24 characters'
    ])
    expect(parseGameLinkTemplates(['nope']).warnings).toEqual([
      'orchestratorGame.links[0] must be a mapping with label and url'
    ])
  })

  it('keeps the first six links', () => {
    const links = Array.from({ length: 8 }, (_, index) => ({
      label: `L${index}`,
      url: `https://x.example/${index}`
    }))
    const parsed = parseGameLinkTemplates(links)

    expect(parsed.value?.map((link) => link.label)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'])
    expect(parsed.warnings).toEqual(['orchestratorGame.links keeps the first 6 entries'])
  })

  it('rejects a value that is not a list', () => {
    expect(parseGameLinkTemplates({ label: 'x' })).toEqual({
      value: undefined,
      warnings: ['orchestratorGame.links must be a list']
    })
  })
})

describe('parseGameActivityRules', () => {
  it('keeps a valid rule', () => {
    expect(parseGameActivityRules([TAMBORA])).toEqual({ value: [TAMBORA], warnings: [] })
  })

  it('drops rules with a broken, empty-matching or oversized pattern, or a URL past its groups', () => {
    const parsed = parseGameActivityRules([
      { ...TAMBORA, match: 'TR-(' },
      { ...TAMBORA, match: 'x*' },
      { ...TAMBORA, match: 'a'.repeat(201) },
      { ...TAMBORA, url: 'https://tambora.example/{2}' },
      { ...TAMBORA, tools: 'mcp__tam bora' },
      { ...TAMBORA, name: '' }
    ])

    expect(parsed.value).toEqual([])
    expect(parsed.warnings).toEqual([
      'orchestratorGame.activity[0].match must be a valid regular expression',
      'orchestratorGame.activity[1].match must not match empty text',
      'orchestratorGame.activity[2].match must be 1 to 200 characters',
      'orchestratorGame.activity[3].url uses an unknown placeholder {2}',
      'orchestratorGame.activity[4].tools must be a tool name glob like mcp__tambora__*',
      'orchestratorGame.activity[5].name must be 1 to 24 characters'
    ])
  })

  it('keeps the first eight rules', () => {
    const parsed = parseGameActivityRules(Array.from({ length: 9 }, () => TAMBORA))

    expect(parsed.value).toHaveLength(8)
    expect(parsed.warnings).toEqual(['orchestratorGame.activity keeps the first 8 entries'])
  })
})

describe('renderGameUrlTemplate', () => {
  it('URL-encodes each value', () => {
    expect(
      renderGameUrlTemplate('https://x.example/b/{branch}?n={review.number}', {
        branch: 'feat/a b',
        'review.number': '12'
      })
    ).toBe('https://x.example/b/feat%2Fa%20b?n=12')
  })

  it('answers null when a placeholder has no value', () => {
    expect(renderGameUrlTemplate('https://x.example/{workItem.identifier}', {})).toBeNull()
  })
})

describe('matchGameActivity', () => {
  const rules = [compileGameActivityRule(TAMBORA)].flatMap((rule) => (rule ? [rule] : []))

  it('builds the URL from the match and its groups', () => {
    expect(
      matchGameActivity(rules, {
        toolName: 'mcp__tambora__create_test_run',
        input: '{"project_key":"CIN"}',
        result: 'Created test run TR-CIN-12'
      })
    ).toEqual({
      name: 'Tambora run',
      id: 'TR-CIN-12',
      url: 'https://tambora.example/projects/CIN/testruns/TR-CIN-12'
    })
  })

  it('ignores tools outside the rule and text past the matching cap', () => {
    expect(
      matchGameActivity(rules, {
        toolName: 'mcp__plane__list_work_items',
        input: '',
        result: 'TR-CIN-12'
      })
    ).toBeNull()
    expect(
      matchGameActivity(rules, {
        toolName: 'mcp__tambora__list_test_cases',
        input: '',
        result: `${'x'.repeat(5000)} TR-CIN-12`
      })
    ).toBeNull()
  })
})

describe('resolveOrchestratorGameIntegrations', () => {
  it('lets a later layer replace the whole list of an earlier one', () => {
    const resolved = resolveOrchestratorGameIntegrations({
      global: { links: [{ label: 'Global', url: 'https://g.example' }], activity: [TAMBORA] },
      project: { links: [{ label: 'Project', url: 'https://p.example' }] },
      local: { activity: [] }
    })

    expect(resolved).toEqual({
      links: [{ label: 'Project', url: 'https://p.example' }],
      activity: []
    })
  })

  it('drops invalid entries a hand-edited Settings layer carries', () => {
    const resolved = resolveOrchestratorGameIntegrations({
      local: { links: [{ label: 'Bad', url: 'file:///etc/passwd' }] }
    })

    expect(resolved.links).toEqual([])
  })
})
