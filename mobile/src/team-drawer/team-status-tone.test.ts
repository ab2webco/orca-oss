import { describe, expect, it } from 'vitest'
import { colors } from '../theme/mobile-theme'
import { TEAM_TONE_DEFAULTS, teamTonesOf } from './team-status-tone'

describe('teamTonesOf', () => {
  it("keeps today's phone colours when nothing is overridden", () => {
    expect(teamTonesOf({})).toEqual({
      attention: colors.statusRed,
      warning: colors.statusAmber,
      info: colors.statusGreen,
      success: colors.statusPurple,
      idle: colors.textMuted
    })
    expect(teamTonesOf({})).toEqual(TEAM_TONE_DEFAULTS)
  })

  it('replaces only the overridden roles', () => {
    expect(teamTonesOf({ info: '#123456', success: '#abcdef' })).toEqual({
      ...TEAM_TONE_DEFAULTS,
      info: '#123456',
      success: '#abcdef'
    })
  })
})
