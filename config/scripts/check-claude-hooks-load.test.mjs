import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const checker = join(projectDir, 'config/scripts/check-claude-hooks-load.py')
const tempDirs = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function check(project) {
  const result = spawnSync('python3', [checker, project], { encoding: 'utf8' })
  return { status: result.status, out: result.stdout + result.stderr }
}

/** A project whose settings register `hooks` and whose hooks folder holds `files`. */
function makeProject(hooks, files) {
  const project = mkdtempSync(join(tmpdir(), 'orca-check-claude-hooks-'))
  tempDirs.push(project)
  mkdirSync(join(project, '.claude/hooks'), { recursive: true })
  const commands = hooks.map((name) => ({
    type: 'command',
    command: `$CLAUDE_PROJECT_DIR/.claude/hooks/${name}`
  }))
  writeFileSync(
    join(project, '.claude/settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: commands }] } })
  )
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(project, '.claude/hooks', name), body)
  }
  return project
}

const okHook = 'import sys\nsys.stdin.read()\n'
// The shape of orca_cli.py: importable, but exits 1 when run with nothing to resolve.
const cliHelper =
  'import sys\ndef value():\n    return 1\nif __name__ == "__main__":\n    sys.exit(1)\n'

describe.skipIf(process.platform === 'win32')('check-claude-hooks-load', () => {
  it('passes on the repo hooks and only imports orca_cli.py', () => {
    const { status, out } = check(projectDir)
    expect(status, out).toBe(0)
    expect(out).toContain('helper .claude/hooks/orca_cli.py: ok')
    expect(out).toContain('hook   .claude/hooks/board-state-guard.py: ok')
  })

  it('imports a helper that exits non-zero as a script instead of running it', () => {
    const project = makeProject(['guard.py'], {
      'guard.py': `from cli_helper import value\n${okHook}`,
      'cli_helper.py': cliHelper
    })
    const { status, out } = check(project)
    expect(status, out).toBe(0)
    expect(out).toContain('helper .claude/hooks/cli_helper.py: ok')
  })

  it('names a helper that fails to import', () => {
    const project = makeProject(['guard.py'], {
      'guard.py': okHook,
      'new_helper.py': 'raise ValueError("boom")\n'
    })
    const { status, out } = check(project)
    expect(status).toBe(1)
    expect(out).toContain('::error file=.claude/hooks/new_helper.py::')
    expect(out).toContain('boom')
  })

  it('names a registered hook that exits non-zero on empty stdin', () => {
    const project = makeProject(['guard.py', 'broken-guard.py'], {
      'guard.py': okHook,
      'broken-guard.py': 'import sys\nsys.exit(3)\n'
    })
    const { status, out } = check(project)
    expect(status).toBe(1)
    expect(out).toContain(
      '::error file=.claude/hooks/broken-guard.py::.claude/hooks/broken-guard.py exited 3'
    )
    expect(out).toContain('hook   .claude/hooks/guard.py: ok')
  })

  it('fails when no hook in the folder is registered', () => {
    const project = makeProject(['elsewhere.py'], { 'cli_helper.py': cliHelper })
    const { status, out } = check(project)
    expect(status, out).toBe(1)
    expect(out).toContain('no .claude/hooks/*.py is registered')
  })
})
