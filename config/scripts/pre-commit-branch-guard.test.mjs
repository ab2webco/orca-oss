import { spawnSync } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const hookScript = join(projectDir, '.claude/hooks/pre-commit-branch-guard.py')
const settingsPath = join(projectDir, '.claude/settings.json')
const tempDirs = []

function makeRepo(branch) {
  const root = mkdtempSync(join(tmpdir(), 'orca-branch-guard-'))
  tempDirs.push(root)
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git(['init', '--quiet'])
  git(['config', 'user.email', 'branch-guard-test@example.com'])
  git(['config', 'user.name', 'Branch Guard Test'])
  git(['checkout', '--quiet', '-b', branch])
  writeFileSync(join(root, 'base.txt'), 'base\n')
  git(['add', '-A'])
  git(['commit', '--quiet', '-m', 'base'])
  return root
}

function runHook(command, branch = 'main') {
  const cwd = makeRepo(branch)
  const result = spawnSync('python3', [hookScript], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd })
  })
  expect(result.status, result.stderr).toBe(0)
  const stdout = result.stdout.trim()
  return stdout ? (JSON.parse(stdout).systemMessage ?? '') : ''
}

describe('pre-commit-branch-guard', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Why este primero: es el caso que hacía ruido en cada comando de la sesión.
  it('says nothing for a command that is not a commit or a push', () => {
    expect(runHook('ls -la')).toBe('')
    expect(runHook('gh pr view 12 --json files')).toBe('')
    expect(runHook('git status --short')).toBe('')
  })

  it('is wired exactly once', () => {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const wirings = (settings.hooks?.PreToolUse ?? []).flatMap(({ matcher, hooks }) =>
      (hooks ?? [])
        .filter(({ command }) => command.endsWith('/pre-commit-branch-guard.py'))
        .map(() => matcher)
    )
    expect(wirings).toEqual(['Bash'])
  })

  it('still names the branch on a commit', () => {
    expect(runHook('git commit -m "wip"')).toContain('rama: main')
  })

  it('still warns on a push from a branch that is not main', () => {
    const note = runHook('git push origin feature', 'feature')
    expect(note).toContain('NO es main')
  })
})
