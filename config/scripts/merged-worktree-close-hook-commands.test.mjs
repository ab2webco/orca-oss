import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  closerArgv,
  denyReason,
  eventDeadline,
  gateTargetDir,
  isGateTrigger,
  isMergeTrigger,
  mergedPrSelectors
} from '../../.claude/hooks/merged-worktree-close-hook.mjs'

const settingsPath = join(resolve(import.meta.dirname, '../..'), '.claude/settings.json')
const hookCommand = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/merged-worktree-close-hook.mjs"'

describe('mergedPrSelectors', () => {
  it.each([
    ['gh pr merge 12 --squash', ['12']],
    ['git fetch && gh pr merge 12 --squash', ['12']],
    ['GH_TOKEN=x gh pr merge 7', ['7']],
    ['env GH_TOKEN=x gh pr merge 7', ['7']],
    ['command gh pr merge 7', ['7']],
    ['gh pr merge 3; gh pr merge 4', ['3', '4']],
    ['gh pr merge --squash 12', ['12']],
    ['gh pr merge -s -d 12', ['12']],
    ['gh pr merge -R o/r --squash 12', ['12']],
    ['gh pr merge --repo=o/r 12', ['12']],
    ['gh pr merge -t "a title" -b body -F notes.md -A a@b.c --match-head-commit abc 12', ['12']],
    ['gh pr merge https://github.com/o/r/pull/12 --squash', ['https://github.com/o/r/pull/12']],
    ['gh pr merge fix/a --squash', ['fix/a']],
    // Why accepted: the hook re-reads the PR and acts only once it is MERGED.
    ['gh pr merge --auto 12', ['12']],
    ['echo "gh pr merge 12"', []],
    ["echo 'a; gh pr merge 12'", []],
    ['cat <<EOF > notes.md\ngh pr merge 12\nEOF', []],
    ["cat > notes.md <<'EOF'\ngh pr merge 12\nEOF", []],
    ['cat <<EOF > notes.md && gh pr merge 5\ngh pr merge 12\nEOF', ['5']],
    ['gh pr \\\n merge 12', ['12']],
    ['gh pr -R o/r merge 12', ['12']],
    ['gh pr --repo=o/r merge --squash 9', ['9']],
    ['gh pr view 12', []],
    // Why: Git Bash on Windows may spell the program out.
    ['gh.exe pr merge 7', ['7']],
    ["cat <<'END-NOTE' > notes.md\ngh pr merge 12\nEND-NOTE", []],
    ['cat <<\\EOF > notes.md\ngh pr merge 12\nEOF', []],
    // Why: bash reads an unterminated heredoc to the end of the script.
    ['cat <<EOF\ngh pr merge 12\n', []],
    ['ls # then; gh pr merge 12', []],
    ['# gh pr merge 12\ngh pr merge 5', ['5']],
    ['echo a#b; gh pr merge 5', ['5']]
  ])('%j -> %j', (command, expected) => {
    expect(mergedPrSelectors(command)).toEqual(expected)
  })
})

describe('isGateTrigger', () => {
  it.each([
    'gh workflow run "Lab Release" --ref main',
    'gh workflow run PR',
    'gh workflow \\\n run x',
    'GH WORKFLOW  RUN lab-release.yml',
    'cd /repo && \\\n gh workflow run lab-release.yml',
    'if true; then gh workflow run "Lab Release"; fi',
    '{ gh workflow run lab-release.yml; }',
    '! gh workflow run x',
    'gh -R ab2webco/orca-oss workflow run lab-release.yml',
    'gh -R x release create mobile-ios-v1',
    'gh release new mobile-android-v1',
    'gh release create v1.2.3',
    "bash -euo pipefail -c 'gh workflow run lab-release.yml'",
    "bash <<'EOF'\ngh workflow run lab-release.yml\nEOF",
    'gh api repos/o/r/actions/workflows/123/dispatches -f ref=main',
    'echo lab release',
    'git push origin mobile-ios-v1.2.3',
    'git tag mobile-android-v2',
    'git push --tags',
    'git push origin --follow-tags',
    'git push --mirror origin',
    'git push origin "refs/tags/*"',
    'git push origin "refs/*:refs/*"',
    "git push origin '*'",
    'git push origin "*"',
    'git push origin *',
    'git push origin * && ls',
    'grep "workflow run" docs',
    'gh workflow -R ab2webco/orca-oss run mobile-ios-release.yml',
    'gh workflow --repo=o/r run 123',
    'gh workflow --repo o/r run "Mobile Android Release"',
    'gh release -R o/r create v1'
  ])('gates %j', (command) => {
    expect(isGateTrigger(command)).toBe(true)
  })

  it.each([
    'ls',
    'npm test',
    'git status',
    'git push origin feat/x',
    'git push -u origin HEAD',
    'git push origin v1.2.3',
    'git push origin "refs/heads/*"',
    'echo "*" && git status',
    'gh pr list',
    'gh workflow list',
    'gh release view v1.2.3',
    'gh workflow view ci.yml && npm run build'
  ])('leaves %j alone', (command) => {
    expect(isGateTrigger(command)).toBe(false)
  })
})

describe('isMergeTrigger', () => {
  it.each([
    'gh pr merge 12',
    'gh pr merge --squash',
    'gh pr \\\n merge 12',
    'gh pr -R o/r merge 12',
    'git fetch && gh pr merge 12',
    'bash -c "gh pr merge 12"',
    'timeout 30 gh pr merge 12'
  ])('runs the closer after %j', (command) => {
    expect(isMergeTrigger(command)).toBe(true)
  })

  it.each([
    'gh pr view 12',
    'git merge main',
    'gh pr list',
    'GH PR  MERGE 1',
    'echo gh pr merge 12',
    'echo "gh pr merge 12"',
    "grep 'gh pr merge' docs/reference/working-process.md",
    "bash <<'EOF'\ngh pr merge 1\nEOF",
    'gh pr comment 12 --body "gh pr merge 12"',
    'ls # gh pr merge 12'
  ])('ignores %j', (command) => {
    expect(isMergeTrigger(command)).toBe(false)
  })
})

describe('gateTargetDir', () => {
  it.each([
    ['gh workflow run "Lab Release"', null],
    ['git push origin mobile-ios-v1', null],
    ["bash <<'EOF'\ngh workflow run x\nEOF", null],
    ['git -C ../repo push --tags', '/base/repo'],
    ['cd ../repo && gh workflow run "Lab Release"', '/base/repo'],
    ['cd /abs/repo; git push origin mobile-ios-v1', '/abs/repo'],
    ['cd /abs && git -C repo push origin mobile-ios-v1', '/abs/repo'],
    [`bash -c 'cd /abs/repo && gh workflow run lab-release.yml'`, '/abs/repo'],
    ['cd /abs/repo && \\\n gh workflow run lab-release.yml', '/abs/repo'],
    ['cd /a && npm run build && cd /b && gh workflow run x', '/b'],
    ["cd /abs/repo && bash <<'EOF'\ngh workflow run x\nEOF", '/abs/repo']
  ])('%j -> %j', (command, dir) => {
    expect(gateTargetDir(command, '/base/cwd')).toBe(dir)
  })
})

describe('eventDeadline', () => {
  it('hands each closer run and PR read only what is left of one budget', () => {
    let now = 1_000
    const deadline = eventDeadline(75_000, () => now)

    expect(closerArgv(['--branch', 'fix/a'], '/s', {}, deadline)).toEqual([
      '--branch',
      'fix/a',
      '--skip-path',
      '/s',
      '--budget-ms',
      '75000'
    ])
    expect(deadline.timeoutMs(20_000)).toBe(20_000)

    now += 60_000
    expect(closerArgv([], '/s', {}, deadline)).toEqual([
      '--skip-path',
      '/s',
      '--budget-ms',
      '15000'
    ])
    expect(deadline.timeoutMs(20_000)).toBe(15_000)

    now += 20_000
    expect(deadline.remainingMs()).toBe(0)
    expect(deadline.timeoutMs(20_000)).toBe(0)
  })

  it('passes no budget when the event has none', () => {
    expect(closerArgv(['--gate'], '/s', { CLAUDE_PROJECT_DIR: '/p' })).toEqual([
      '--gate',
      '--skip-path',
      '/s',
      '--skip-path',
      '/p'
    ])
  })
})

describe('denyReason', () => {
  it('lists a worktree whose Orca terminal error spans several lines', () => {
    const reason = denyReason([
      'kept fix/a (#12): could not read Orca terminals (timeout\nretry) /wt/fix-a'
    ])
    expect(reason).toMatch(/^Comando bloqueado: parece un release y hay worktrees/)
    expect(reason).toContain('- fix/a (#12): no se pudieron leer las terminales de Orca (timeout')
    expect(reason).not.toContain('kept fix/a')
  })

  it('translates every unverified reason the closer prints', () => {
    const reason = denyReason([
      'unverified fix/a: time budget exhausted',
      'unverified fix/b: could not read its PRs (gh: HTTP 502)',
      'unverified: /x is not a git repository'
    ])
    expect(reason).toMatch(/^Comando bloqueado: parece un release y no se pudo verificar/)
    expect(reason).toContain('- fix/a: se agotó el tiempo para verificarla')
    expect(reason).toContain('- fix/b: no se pudieron leer sus PRs (gh: HTTP 502)')
    expect(reason).toContain('- /x no es un repositorio git')
    expect(reason).not.toContain('unverified')
  })
})

describe('merged-worktree-close hook wiring', () => {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const entries = (event) =>
    (settings.hooks?.[event] ?? []).flatMap((group) =>
      (group.hooks ?? []).map((hook) => ({ ...hook, matcher: group.matcher }))
    )
  const wired = (event) => entries(event).filter((hook) => hook.command === hookCommand)

  it('runs at session start after the coordinator sweep', () => {
    const all = entries('SessionStart')
    const sweep = all.findIndex((hook) => hook.command.includes('coordinator-sweep.sh'))
    const closer = all.findIndex((hook) => hook.command === hookCommand)
    expect(sweep).toBeGreaterThanOrEqual(0)
    expect(closer).toBeGreaterThan(sweep)
    expect(all[closer]).toMatchObject({
      timeout: 90,
      statusMessage: 'Cerrando worktrees de PRs mergeados...'
    })
  })

  // Why: the sweep takes up to 79 s and a matcher-less hook also runs on compact and clear (ORCA-1021).
  it.each(['coordinator-sweep.sh', 'merged-worktree-close-hook.mjs'])(
    'runs %s only at startup, never on a compaction',
    (script) => {
      const hooks = entries('SessionStart').filter((hook) => hook.command.includes(script))
      expect(hooks).toEqual([expect.objectContaining({ matcher: 'startup' })])
    }
  )

  // Why resume: Orca reopens a lead with `claude --resume`, and that is the restart ORCA-987 fixed.
  it('resumes members when a lead starts or is reopened, not on a compaction', () => {
    const hooks = entries('SessionStart').filter((hook) =>
      hook.command.includes('session-start-lead-recovery.sh')
    )
    expect(hooks).toEqual([expect.objectContaining({ matcher: 'startup|resume' })])
  })

  // Why no `if`: a prefix filter misses `env X=1 gh ...`, `command gh ...` and `git -C <dir> push`.
  it('sees every Bash command after it runs, to catch merges', () => {
    const hooks = wired('PostToolUse')
    expect(hooks).toEqual([expect.objectContaining({ matcher: 'Bash', timeout: 90 })])
    expect(hooks[0].if).toBeUndefined()
  })

  it('sees every Bash command before it runs, to gate releases', () => {
    const hooks = wired('PreToolUse')
    expect(hooks).toEqual([expect.objectContaining({ matcher: 'Bash', timeout: 90 })])
    expect(hooks[0].if).toBeUndefined()
  })
})
