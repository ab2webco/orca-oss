import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SKILLS = join(__dirname, '../../resources/claude-plugins/orca-game/skills')
const skillText = (name: string): string => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')

// Why: a mod cannot register `orca-game:x` itself, so each game command is a skill the mod answers
// (its tests run these names; hooks/game-commands.ts lists them).
describe('the game commands under /orca-game:', () => {
  it('has a person-only skill for every command the mod answers', () => {
    for (const name of ['quest', 'mode', 'render', 'demo', 'state']) {
      const text = skillText(name)
      expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\n`))
      expect(text).toContain('disable-model-invocation: true')
    }
  })
})

describe('the lead skill', () => {
  it('reads the mode and render the pane set as its own, not a config discrepancy', () => {
    const text = skillText('lead')
    expect(text).toContain('/orca-game:mode')
    expect(text).toContain('/orca-game:render')
    expect(text).toMatch(/only this pane/)
  })

  it('carries the decision bar, the decision-gate wait and the advisor step', () => {
    const text = skillText('lead')
    expect(text).toMatch(/decision gate/)
    expect(text).toMatch(/only they can decide/)
    expect(text).toMatch(/advisor/)
  })

  // Why: without --terminal, `orchestration inbox` returns every project's mail on the machine.
  it('reads its mail only through game inbox', () => {
    const text = skillText('lead')
    expect(text).toContain('game inbox')
    expect(text).toMatch(/never with a bare\s+`orchestration inbox`/)
  })
})
