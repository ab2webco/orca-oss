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
    ['gh pr view 12', []]
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
    'gh pr \\\n merge 12',
    'GH PR  MERGE 1',
    "bash <<'EOF'\ngh pr merge 1\nEOF",
    'gh pr -R o/r merge 12'
  ])('runs the closer after %j', (command) => {
    expect(isMergeTrigger(command)).toBe(true)
  })

  it.each(['gh pr view 12', 'git merge main', 'gh pr list'])('ignores %j', (command) => {
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
  it('lists a worktree whose removal error spans several lines', () => {
    const reason = denyReason([
      'kept fix/a (#12): worktree removal failed (/wt/fix-a): fatal: cannot remove\nuse -f -f'
    ])
    expect(reason).toMatch(/^Comando bloqueado: parece un release y hay worktrees/)
    expect(reason).toContain('- fix/a (#12): no se pudo quitar (/wt/fix-a): fatal: cannot remove')
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
