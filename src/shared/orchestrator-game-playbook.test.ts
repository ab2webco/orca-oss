import { describe, expect, it } from 'vitest'
import {
  gamePlaybookBriefLine,
  gamePlaybookOf,
  parseGameLaunchKind,
  parsePlaybooksDir
} from './orchestrator-game-playbook'
import { parseGameLead } from './orchestrator-game-lead'

describe('parseGameLaunchKind (ORCA-1425)', () => {
  it('launches a playbook kind as the model kind an older host still accepts', () => {
    expect(parseGameLaunchKind('bug-fix')).toEqual({ kind: 'implement', playbook: 'bug-fix' })
    expect(parseGameLaunchKind(' Feature ')).toEqual({ kind: 'implement', playbook: 'feature' })
    expect(parseGameLaunchKind('review')).toEqual({ kind: 'review', playbook: 'review' })
    expect(parseGameLaunchKind('live-check')).toEqual({ kind: 'captures', playbook: 'live-check' })
    expect(parseGameLaunchKind('audit')).toEqual({ kind: 'audit' })
    expect(parseGameLaunchKind('qa')).toBeNull()
  })
})

describe('gamePlaybookOf', () => {
  it('takes the named playbook, else the one the model kind or title implies, else none', () => {
    expect(gamePlaybookOf({ kind: 'implement', playbook: 'bug-fix' }, 'Review it')).toBe('bug-fix')
    expect(gamePlaybookOf({ kind: 'captures' }, 'x')).toBe('live-check')
    expect(gamePlaybookOf({}, 'Review PR #12')).toBe('review')
    expect(gamePlaybookOf({}, 'Sidebar layout')).toBeNull()
    expect(gamePlaybookOf({ kind: 'audit' }, 'Review it')).toBeNull()
  })
})

describe('orchestrator.playbooks', () => {
  it('keeps a folder inside the repo and refuses one that leaves it', () => {
    expect(parsePlaybooksDir(' docs/reference/playbooks/ ')).toBe('docs/reference/playbooks')
    for (const bad of ['/etc', '../x', 'docs/../..', './docs', 'a b', '', 3]) {
      expect(parsePlaybooksDir(bad)).toBeNull()
    }
    expect(parseGameLead({ playbooks: 'docs/playbooks' })).toEqual({
      value: { playbooks: 'docs/playbooks' },
      warnings: []
    })
    expect(parseGameLead({ playbooks: '../x' }).warnings).toEqual([
      'orchestratorGame.orchestrator.playbooks must be a folder inside the repo, like docs/playbooks'
    ])
  })
})

describe('gamePlaybookBriefLine', () => {
  it('links the playbook, or the folder, only when the project keeps one', () => {
    expect(gamePlaybookBriefLine(undefined, { playbook: 'bug-fix' }, 'x')).toBeNull()
    expect(gamePlaybookBriefLine('docs/p', { kind: 'implement', playbook: 'bug-fix' }, 'x')).toBe(
      'Playbook: read docs/p/bug-fix.md before you start. Copy each step into your todo list and keep it, or mark it `skip: <reason>`; never drop one.'
    )
    expect(gamePlaybookBriefLine('docs/p', {}, 'Sidebar layout')).toMatch(
      /^Playbooks: docs\/p\/ has one per task kind \(bug-fix, feature, review, live-check\);/
    )
  })
})
