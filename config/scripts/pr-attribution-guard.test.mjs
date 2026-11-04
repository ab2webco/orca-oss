import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hook = join(projectDir, '.claude/hooks/pr-attribution-guard.mjs')
const SIGNATURE = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
const cwd = mkdtempSync(join(tmpdir(), 'orca-pr-attribution-guard-'))
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

function decide(command) {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8'
  })
  expect(result.status).toBe(0)
  return result.stdout === ''
    ? 'allow'
    : JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
}

function bodyFile(name, ...lines) {
  writeFileSync(join(cwd, name), ['## What Changed', '', 'Fixes it.', '', ...lines].join('\n'))
  return name
}

describe('pr-attribution-guard', () => {
  // #912: the footer lived in a file written by a file tool, so the command text was clean.
  it('denies a --body-file whose contents carry the signature', () => {
    const file = bodyFile('signed.md', SIGNATURE)
    expect(decide(`gh pr create --title "fix: x" --body-file ${file}`)).toBe('deny')
    expect(decide(`gh pr edit 912 -F ${file}`)).toBe('deny')
    expect(decide(`gh pr edit 912 --body-file=${join(cwd, file)}`)).toBe('deny')
  })

  it('denies a disclosure line written in place of the signature', () => {
    const file = bodyFile('disclosed.md', 'Written with Claude Code (Opus 5.5)')
    expect(decide(`gh pr create --title "fix: x" --body-file ${file}`)).toBe('deny')
  })

  it('denies the signature passed inline, on one line or through a heredoc', () => {
    expect(decide(`gh pr create --title "fix: x" --body '${SIGNATURE}'`)).toBe('deny')
    expect(
      decide(
        `gh pr create --title "fix: x" --body "$(cat <<'EOF'\nFixes it.\n\n${SIGNATURE}\nEOF\n)"`
      )
    ).toBe('deny')
    expect(decide(`gh pr edit 1 --title 'Generated with Codex'`)).toBe('deny')
  })

  it('allows a body co-authored by a person', () => {
    const file = bodyFile('human.md', 'Co-authored-by: Jinwoo-H <jinwoo0825@gmail.com>')
    expect(decide(`gh pr create --title "fix: x" --body-file ${file}`)).toBe('allow')
  })

  it('ignores commands that write no PR text', () => {
    const file = bodyFile('other.md', SIGNATURE)
    expect(decide(`cat ${file}`)).toBe('allow')
    expect(decide('gh pr view 912')).toBe('allow')
  })

  it('is registered for every Bash call', () => {
    const settings = JSON.parse(readFileSync(join(projectDir, '.claude/settings.json'), 'utf8'))
    const registered = settings.hooks.PreToolUse.some(
      ({ matcher, hooks }) =>
        matcher === 'Bash' &&
        hooks.some(({ command, if: only }) => command.includes('pr-attribution-guard.mjs') && !only)
    )
    expect(registered).toBe(true)
  })
})
