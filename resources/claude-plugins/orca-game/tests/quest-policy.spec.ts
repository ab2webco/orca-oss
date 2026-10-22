import { describe, expect, it } from 'vitest'

import {
  actionOf,
  activityOf,
  cardKeyOf,
  isFinishingCall,
  isWorkingNote,
  noteKey,
  phaseOf,
  questCommandOf,
  restoredNotesOf
} from '../hooks/quest-policy'
import { setGameLocale } from '../hooks/game-strings'

describe('quest policy', () => {
  it('/quest with no argument shows the mode and rejects an unknown one', () => {
    expect(questCommandOf('')).toEqual({ show: true })
    expect(questCommandOf(' ZEN ')).toEqual({ mode: 'zen' })
    expect(questCommandOf('zen please')).toEqual({ mode: 'zen' })
    expect(questCommandOf('loud')).toEqual({
      error:
        'Unknown mode "loud". Use /orca-game:mode on, /orca-game:mode zen, /orca-game:mode flat, /orca-game:mode off or /orca-game:demo.'
    })
    expect(questCommandOf('demo')).toEqual({ demo: true })
  })

  it('the bubble says what the session is doing in a few words', () => {
    expect(activityOf('Read', { file_path: '/repo/hooks/quest.tsx' })).toBe('Reading quest.tsx')
    expect(activityOf('Edit', { file_path: '/repo/a/b.ts' })).toBe('Editing b.ts')
    expect(
      activityOf('Bash', { command: 'git status', description: 'Show working tree status' })
    ).toBe('Show working tree status')
    expect(activityOf('Bash', { command: 'pnpm test\n--run' })).toBe('pnpm test')
    expect(activityOf('Grep', { pattern: 'x' })).toBe('Searching the code')
    expect(activityOf('Agent', { description: 'Rewrite the reply' })).toBe(
      'Delegating: Rewrite the reply'
    )
    expect(activityOf('mcp__claude_ai_Slack__slack_read_thread', {})).toBe(
      'Using claude_ai_Slack slack_read_thread'
    )
    expect(activityOf('Bash', { command: 'x'.repeat(80) })).toHaveLength(60)
  })

  it('the bubble and /quest speak the language the session was launched with', () => {
    setGameLocale('es')
    try {
      expect(activityOf('Read', { file_path: '/repo/hooks/quest.tsx' })).toBe('Leyendo quest.tsx')
      expect(activityOf('Grep', { pattern: 'x' })).toBe('Buscando en el código')
      expect(questCommandOf('loud')).toEqual({
        error:
          'Modo desconocido "loud". Usa /orca-game:mode on, /orca-game:mode zen, /orca-game:mode flat, /orca-game:mode off o /orca-game:demo.'
      })
    } finally {
      setGameLocale('en')
    }
  })

  it('short text before a tool call is a working note; long or multi-line text is a reply', () => {
    const midTurn = { stopReason: 'tool_use', toolUses: [{}] }
    expect(isWorkingNote(midTurn, 'Checking the mod API.')).toBe(true)
    expect(isWorkingNote(midTurn, '- one\n- two')).toBe(false)
    expect(isWorkingNote(midTurn, 'x'.repeat(240))).toBe(false)
    expect(isWorkingNote({ stopReason: 'end_turn', toolUses: [] }, 'Done.')).toBe(false)
    expect(isWorkingNote({ stopReason: 'max_tokens', toolUses: [{}] }, 'Going on.')).toBe(true)
    expect(noteKey('  hi  ')).toBe('hi')
    expect(noteKey('a\nb')).toBe('a\nb\n')
  })

  it('a resumed transcript recovers which rows were working notes', () => {
    const rows = [
      { role: 'user', text: 'fix the deploy', toolUses: [] },
      { role: 'assistant', text: 'Checking the runs.', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{}] },
      { role: 'assistant', text: '- Cause: UAT never got 0.3.13.\n- Deployed.', toolUses: [] }
    ] as const
    expect(restoredNotesOf(rows)).toEqual({
      notes: ['Checking the runs.'],
      replies: ['- Cause: UAT never got 0.3.13.\n- Deployed.\n']
    })
  })

  it('a message card is keyed by its message, so the same text later gets its own phase', () => {
    expect(cardKeyOf('m1', 'Done.')).not.toBe(cardKeyOf('m2', 'Done.'))
    expect(cardKeyOf('m1', ' Done. ')).toBe(cardKeyOf('m1', 'Done.'))
  })
})

describe('flow phase', () => {
  it('each step of the flow moves the scene to its phase', () => {
    expect(phaseOf('Write', { file_path: '/w/docs/features/313-x/spec.md' })).toBe('docs')
    expect(phaseOf('Edit', { file_path: '/w/README.md' })).toBe('docs')
    expect(phaseOf('Edit', { file_path: '/w/apps/web/src/view.tsx' })).toBe('build')
    expect(phaseOf('Bash', { command: 'pnpm --filter web exec vitest run' })).toBe('verify')
    expect(phaseOf('Bash', { command: 'npm test' })).toBe('verify')
    expect(phaseOf('Bash', { command: 'cargo test' })).toBe('verify')
    expect(phaseOf('Bash', { command: 'git push -u origin feat/x' })).toBe('pr')
    expect(phaseOf('Bash', { command: 'gh pr create --title x' })).toBe('pr')
    expect(phaseOf('Bash', { command: 'glab mr create --fill' })).toBe('pr')
    expect(phaseOf('Bash', { command: 'gh pr merge 9 --squash' })).toBe('handoff')
    expect(phaseOf('Bash', { command: 'glab mr merge 9' })).toBe('handoff')
    expect(phaseOf('Bash', { command: 'orca plane status set ORCA-1 --state Done' })).toBe(
      'handoff'
    )
    expect(phaseOf('Bash', { command: 'orca linear status set ENG-2 Done' })).toBe('handoff')
    expect(phaseOf('mcp__plane__update_work_item', {})).toBe('handoff')
    expect(phaseOf('Skill', { skill: 'frontend-handoff-to-qa' })).toBe('handoff')
    expect(phaseOf('Skill', { skill: 'frontend-verify' })).toBe('verify')
    expect(phaseOf('Edit', {})).toBe('build')
    expect(phaseOf('Read', { file_path: '/w/a.ts' })).toBeUndefined()
    expect(phaseOf('Bash', { command: 'git status' })).toBeUndefined()
    expect(phaseOf('Bash', {})).toBeUndefined()
  })

  it('a merge or a tracker status change finishes the session', () => {
    expect(isFinishingCall('Bash', { command: 'gh pr merge 946 --squash' })).toBe(true)
    expect(isFinishingCall('Bash', { command: 'glab mr merge 12' })).toBe(true)
    expect(isFinishingCall('Bash', { command: 'orca plane status set ORCA-1 Done' })).toBe(true)
    expect(isFinishingCall('Bash', { command: 'gh pr view 946' })).toBe(false)
  })
})

describe('actions', () => {
  it('each flow action maps from the tool call quest already sees', () => {
    expect(actionOf('Read', { file_path: '/a.ts' })).toBe('read')
    expect(actionOf('Grep', { pattern: 'x' })).toBe('read')
    expect(actionOf('Edit', { file_path: '/a.ts' })).toBe('edit')
    expect(actionOf('Bash', { command: 'pnpm test --run' })).toBe('test')
    expect(actionOf('Bash', { command: 'git commit -m "x"' })).toBe('commit')
    expect(actionOf('Bash', { command: 'git push -u origin feat/x' })).toBe('push')
    expect(actionOf('Bash', { command: 'gh pr create --fill' })).toBe('push')
    expect(actionOf('Bash', { command: 'gh pr merge 9 --squash' })).toBe('merge')
    expect(actionOf('Bash', { command: 'orca linear status set ENG-2 Done' })).toBe('track')
    expect(actionOf('mcp__plane__update_work_item', {})).toBe('track')
    expect(actionOf('Bash', { command: 'make' })).toBeUndefined()
    expect(actionOf('Bash', {})).toBeUndefined()
  })
})
