import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOrcaYaml } from './orca-yaml'

// Why: /orca-game:setup copies this example into projects, so it must parse with no warnings.
const REFERENCE = join(
  __dirname,
  '../../resources/claude-plugins/orca-game/skills/setup/reference.md'
)

describe('the /orca-game:setup key summary', () => {
  it('is an orca.yaml the game parses with no warnings, every orchestrator key set', () => {
    const text = readFileSync(REFERENCE, 'utf8')
    const yaml = text.split('```yaml')[1]?.split('```')[0] ?? ''

    const parsed = parseOrcaYaml(yaml)

    expect(parsed?.orchestratorGameWarnings ?? []).toEqual([])
    expect(parsed?.orchestratorGame?.orchestrator).toEqual(
      expect.objectContaining({ accounts: 'auto', cap: 4, agent: 'claude' })
    )
    expect(parsed?.orchestratorGame).toMatchObject({
      render: 'hd',
      timezone: 'America/Bogota',
      rewardWeights: { 'ci-green': 10, 'member-claimed': 0 }
    })
  })
})
