import { describe, expect, it } from 'vitest'
import { parseOrcaYaml } from './orca-yaml'

describe('parseOrcaYaml orchestratorGame', () => {
  it('reads the project layer of the orchestrator game', () => {
    const parsed = parseOrcaYaml('orchestratorGame:\n  mode: zen\n  tracker: false\n')

    expect(parsed?.orchestratorGame).toEqual({ mode: 'zen', tracker: false })
    expect(parsed?.orchestratorGameWarnings).toBeUndefined()
  })

  it("reads the lead's memberNames, plain or per language", () => {
    const parsed = parseOrcaYaml(`orchestratorGame:
  orchestrator:
    memberNames:
      - Mario
      - en: Peach
        es: Melocotón
`)

    expect(parsed?.orchestratorGame).toEqual({
      orchestrator: { memberNames: ['Mario', { en: 'Peach', es: 'Melocotón' }] }
    })
    expect(parsed?.orchestratorGameWarnings).toBeUndefined()
  })

  it('keeps the valid fields and reports the invalid ones', () => {
    const parsed = parseOrcaYaml('orchestratorGame:\n  mode: loud\n  hud: false\n')

    expect(parsed?.orchestratorGame).toEqual({ hud: false })
    expect(parsed?.orchestratorGameWarnings).toEqual([
      'orchestratorGame.mode must be one of on, zen, flat, off'
    ])
  })

  it('reads project links and activity rules, reporting the invalid ones', () => {
    const parsed = parseOrcaYaml(`orchestratorGame:
  links:
    - label: Board
      url: https://plane.example/ws
    - label: Bad
      url: ftp://plane.example/ws
  activity:
    - name: Tambora run
      tools: mcp__tambora__*
      match: 'TR-([A-Z]+)-\\d+'
      url: https://tambora.example/projects/{1}/testruns/{0}
`)

    expect(parsed?.orchestratorGame).toEqual({
      links: [{ label: 'Board', url: 'https://plane.example/ws' }],
      activity: [
        {
          name: 'Tambora run',
          tools: 'mcp__tambora__*',
          match: 'TR-([A-Z]+)-\\d+',
          url: 'https://tambora.example/projects/{1}/testruns/{0}'
        }
      ]
    })
    expect(parsed?.orchestratorGameWarnings).toEqual([
      'orchestratorGame.links[1].url must be an http(s) URL with a literal host'
    ])
  })

  it('leaves the other project defaults untouched', () => {
    const parsed = parseOrcaYaml('scripts:\n  setup: pnpm install\n')

    expect(parsed?.scripts.setup).toBe('pnpm install')
    expect(parsed?.orchestratorGame).toBeUndefined()
  })
})
