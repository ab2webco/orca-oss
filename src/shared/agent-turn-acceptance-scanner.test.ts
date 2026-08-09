import { describe, expect, it } from 'vitest'
import { createAgentTurnAcceptanceScanner } from './agent-turn-acceptance-scanner'

const osc = (title: string): string => `\x1b]0;${title}\x07`

describe('createAgentTurnAcceptanceScanner (ORCA-191)', () => {
  it('accepts on the agent repainting its title as working', () => {
    const scanner = createAgentTurnAcceptanceScanner()
    expect(scanner.observe('\x1b[2J').accepted).toBe(false)
    expect(scanner.observe(osc('\u280b Claude'))).toEqual({
      accepted: true,
      evidence: 'working-title'
    })
  })

  it('accepts on the agent’s own interrupt affordance', () => {
    const scanner = createAgentTurnAcceptanceScanner()
    expect(scanner.observe('Working (0s • esc to interrupt)')).toEqual({
      accepted: true,
      evidence: 'interrupt-affordance'
    })
  })

  it('matches an affordance repainted with styling in the middle', () => {
    const scanner = createAgentTurnAcceptanceScanner()
    expect(scanner.observe('Working (2s • \x1b[1mesc\x1b[0m to interrupt)').accepted).toBe(true)
  })

  it('matches an affordance split across two chunks', () => {
    const scanner = createAgentTurnAcceptanceScanner()
    expect(scanner.observe('Working (0s • esc to int').accepted).toBe(false)
    expect(scanner.observe('errupt)').accepted).toBe(true)
  })

  it('does not accept on an idle title', () => {
    const scanner = createAgentTurnAcceptanceScanner()
    expect(scanner.observe(osc('\u2733 Claude')).accepted).toBe(false)
  })

  // Why: the constraint this whole design exists for. A long preamble is
  // collapsed by Codex into a placeholder, so the payload never appears on
  // screen — an echo check would report "not delivered" for exactly the
  // messages a dispatch is made of, and the six-copy interleaving incident is
  // what a retry on that false negative produces.
  it('does not depend on the payload appearing on screen', () => {
    const scanner = createAgentTurnAcceptanceScanner()
    expect(scanner.observe('› [Pasted Content 1206 chars]').accepted).toBe(false)
    expect(scanner.observe(`${osc('\u2839 Codex')}`).accepted).toBe(true)
  })

  it('does not accept on a redraw that only repaints the composer', () => {
    const scanner = createAgentTurnAcceptanceScanner()
    expect(scanner.observe('\x1b[2J\x1b[H› \x1b[?25h').accepted).toBe(false)
  })
})
