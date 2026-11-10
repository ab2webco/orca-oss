import { describe, expect, it, vi } from 'vitest'
import {
  teamConditionText,
  teamHostText,
  teamLeadLiveText,
  teamLiveText,
  teamModelText,
  teamPhaseText,
  teamAgeText,
  teamStatusGlyph,
  teamStatusTone
} from './team-card-text'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))

describe('teamLeadLiveText', () => {
  it("prefixes what a working lead does with V30's verb, and leaves every other line alone", () => {
    expect(
      teamLeadLiveText({ kind: 'tool', tool: 'Read', detail: 'game-state.ts' }, 'working')
    ).toBe('Orchestrating · Read · game-state.ts')
    expect(teamLeadLiveText(null, 'working')).toBe('Working')
    expect(
      teamLeadLiveText({ kind: 'question', text: 'Merge #923 now?', options: ['Yes'] }, 'waiting')
    ).toBe('Merge #923 now?')
    expect(teamLeadLiveText({ kind: 'tool', tool: 'Read', detail: null }, 'idle')).toBe('Read')
  })
})

describe('teamLiveText tool labels', () => {
  it('names the tool on every row, as V28 soloNow does', () => {
    expect(
      teamLiveText({ kind: 'tool', tool: 'Bash', detail: 'gh pr checks 912' }, 'working')
    ).toBe('Bash · gh pr checks 912')
    expect(teamLiveText({ kind: 'tool', tool: 'Bash', detail: null }, 'working')).toBe('Bash')
  })

  it('leaves questions and links to the shared text', () => {
    expect(
      teamLiveText({ kind: 'question', text: 'Merge #923 now?', options: ['Yes'] }, 'waiting')
    ).toBe('Merge #923 now?')
    expect(teamLiveText(null, 'working')).toBe('Working')
  })
})

describe('teamLiveText', () => {
  // Why (ORCA-1129): a team card showed a bare command, unlike every other tool label.
  it("names a command's tool on a team card too, and the tool alone without detail", () => {
    expect(teamLiveText({ kind: 'tool', tool: 'Bash', detail: 'gh pr view 923' }, 'working')).toBe(
      'Bash · gh pr view 923'
    )
    expect(teamLiveText({ kind: 'tool', tool: 'Bash', detail: null }, 'working')).toBe('Bash')
  })

  it('never names the question tool on a card', () => {
    expect(teamLiveText({ kind: 'tool', tool: 'AskUserQuestion', detail: null }, 'working')).toBe(
      'Waiting for you'
    )
  })

  it('shows a question as written', () => {
    expect(
      teamLiveText({ kind: 'question', text: 'Merge #923 now?', options: ['Yes'] }, 'waiting')
    ).toBe('Merge #923 now?')
  })

  it('names the linked item an MCP call opened', () => {
    expect(
      teamLiveText(
        { kind: 'link', name: 'Plane', id: 'ORCA-1047', url: 'https://x.test', running: true },
        'working'
      )
    ).toBe('Plane · ORCA-1047')
  })

  it('falls back to the condition word with no live action', () => {
    expect(teamLiveText(null, 'limited')).toBe('Usage limit reached')
    expect(teamLiveText(null, 'waiting')).toBe('Waiting for you')
  })
})

describe('card words', () => {
  it('has a word for every condition', () => {
    const conditions = [
      'working',
      'waiting',
      'idle',
      'done',
      'starting',
      'queued',
      'paused',
      'asleep',
      'limited',
      'loggedOut',
      'unreachable',
      'gone',
      'startFailed'
    ] as const
    const words = conditions.map(teamConditionText)
    expect(new Set(words).size).toBe(conditions.length)
  })

  it('names the phase the member is in', () => {
    expect(teamPhaseText('code')).toBe('Coding')
    expect(teamPhaseText('pr')).toBe('In PR')
  })

  it('joins model and effort, and drops a missing effort', () => {
    expect(teamModelText({ label: 'Opus 5.5', effort: 'high', source: 'session' })).toBe(
      'Opus 5.5 · high'
    )
    expect(teamModelText({ label: 'Opus 5.5', effort: null, source: 'launch' })).toBe('Opus 5.5')
    expect(teamModelText(null)).toBeNull()
  })

  it('names the host', () => {
    expect(teamHostText({ kind: 'local' })).toBe('local')
    expect(
      teamHostText({ kind: 'remote', name: 'imac', environmentId: 'env', reachable: true })
    ).toBe('imac')
  })

  it('maps each status to its colour tone', () => {
    expect(teamStatusTone('attention')).toBe('attention')
    expect(teamStatusTone('risk')).toBe('warning')
    expect(teamStatusTone('working')).toBe('info')
    expect(teamStatusTone('done')).toBe('success')
    expect(teamStatusTone('idle')).toBe('idle')
  })

  it('marks needs-you or failed with a question and working with a spinner', () => {
    expect(teamStatusGlyph('attention')).toBe('question')
    expect(teamStatusGlyph('working')).toBe('spinner')
    expect(teamStatusGlyph('risk')).toBe('dot')
    expect(teamStatusGlyph('done')).toBe('dot')
    expect(teamStatusGlyph('idle')).toBe('dot')
  })

  it('reads an age short, as V28 does', () => {
    const now = 10 * 86_400_000
    expect(teamAgeText(now - 20_000, now)).toBe('now')
    expect(teamAgeText(now - 10 * 60_000, now)).toBe('10 min')
    expect(teamAgeText(now - 13 * 3_600_000, now)).toBe('13 h')
    expect(teamAgeText(now - 3 * 86_400_000, now)).toBe('3 d')
  })
})
