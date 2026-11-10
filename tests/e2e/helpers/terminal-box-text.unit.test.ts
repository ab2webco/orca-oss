import { describe, expect, it } from 'vitest'
import { boxedTexts } from './terminal-box-text'

// ORCA-1148: rows a 36-column Claude Code pane drew for orca-game's merge toasts (300 px on macOS;
// Linux CI's wider glyphs wrap the same toast at 320 px). The perfect-merge toast wraps after
// `#123`, beside the auto-mode notice, so neither one row nor the whole row joined holds the cue.
const WRAPPED = [
  '                            +5 more ',
  '  ╭────────────────────────────────╮',
  ' ▐│ orca-game                      │',
  '▝▜│ +100 XP · LUM-14 · #122 merged │',
  ' ▝╰────────────────────────────────╯',
  '  ╭────────────────────────────────╮',
  '▎ │ orca-game                      │',
  '▎ │ +100 XP · LUM-15 · #123 merged │',
  '▎ ╰────────────────────────────────╯',
  '▎ permis╭──────────────────────────╮',
  '▎ Claude│ orca-game                │',
  '▎ risky │ +100 XP · LUM-15 · #123  │',
  '▎ before│ perfect merge            │',
  '▎ it ass╰──────────────────────────╯',
  '▎ blocks the rest.',
  '────────────────────────────────────',
  '❯  '
]

describe('boxedTexts', () => {
  it('reads each box whole, across the rows its text wraps onto', () => {
    expect(boxedTexts(WRAPPED)).toEqual([
      'orca-game +100 XP · LUM-14 · #122 merged',
      'orca-game +100 XP · LUM-15 · #123 merged',
      'orca-game +100 XP · LUM-15 · #123 perfect merge'
    ])
  })

  it('keeps what is drawn beside a box out of its text', () => {
    expect(WRAPPED.some((row) => row.includes('LUM-15 · #123 perfect'))).toBe(false)
    expect(boxedTexts(WRAPPED).join('\n')).not.toMatch(/risky|before/)
  })

  it('reads nothing from rows without a box', () => {
    expect(boxedTexts(['❯  ', '──────', '  ⏵⏵ auto mode on'])).toEqual([])
  })
})
