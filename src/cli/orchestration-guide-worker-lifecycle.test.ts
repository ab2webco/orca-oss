import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILL_GUIDES } from './bundled-skill-guides'

function orchestrationGuide(): string {
  const guide = BUNDLED_SKILL_GUIDES.find((candidate) => candidate.name === 'orchestration')
  if (!guide) {
    throw new Error('missing bundled orchestration guide')
  }
  return guide.fullMarkdown
}

describe('bundled orchestration guide worker lifecycle', () => {
  it('teaches agent-first worker launches instead of raw agent commands', () => {
    const guide = orchestrationGuide()

    expect(guide).toContain(
      'orca terminal create --worktree active --title <task-name> --agent codex'
    )
    expect(guide).toContain(
      'orca terminal create --worktree active --title login-css-worker --agent claude'
    )
    expect(guide).not.toContain('--command "codex" --json')
    expect(guide).not.toContain('--command "claude" --json')
  })

  it('states that raw --command skips the configured permission defaults', () => {
    const guide = orchestrationGuide()

    expect(guide).toMatch(
      /Raw `--command` launches argv verbatim and applies none of those defaults/
    )
    expect(guide).toContain('mutually exclusive')
  })

  it('makes closing a finished worker part of the cycle, verified by re-listing', () => {
    const guide = orchestrationGuide()

    expect(guide).toContain('## Closing Workers')
    expect(guide).toContain('orca terminal close --terminal <handle> --json')
    expect(guide).toContain('terminal_handle_stale')
    expect(guide).toMatch(/Verify the close by re-listing, never by the return value alone/)
    expect(guide).toMatch(/final `orca terminal list --worktree <selector> --json`/)
  })
})
